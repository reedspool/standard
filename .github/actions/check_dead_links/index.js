#!/usr/bin/env node

const fetch = require("node-fetch");
const { Cluster } = require('puppeteer-cluster');
const markdownLinkExtractor = require('markdown-link-extractor');
const glob = require("glob");
const { promises: { readFile } } = require("fs");
const root = process.env.GITHUB_WORKSPACE;
const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.GITHUB_SHA;
const separator = "\n--------------------------------------------------\n";
const AsciiTable = require("ascii-table");
const redX = "\x1b[31m✖\x1b[0m"; // Red-colored unicode "x"


// Raise to go faster, limited only by the github action hardware.
const clusterMaxConcurrent = 10;

process.on("unhandledRejection", error => {
    console.log("EXITING on unhandled promise rejection:", error);
    process.exit(1);
});

async function main() {

    console.log(separator);
    console.log(`Searching ${root} for markdown files...`);

    const files = await getFiles(`${root}/**/*.md`);
    console.log(`Found ${files.length} markdown files.`);
    console.log(separator);

    console.log(
        `Setup Puppeteer Cluster, max concurrency: ${clusterMaxConcurrent}`);

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_BROWSER,
        maxConcurrency: clusterMaxConcurrent,

        // args passed to puppeteer browser.launch()
        // --no-sandbox required when running as root, which Docker does
        puppeteerOptions: { args: ['--no-sandbox'] }
    });

    // Define the only task for this cluster, whose input is a URL to check
    await cluster.task(async ({ page, data: url }) => page.goto(url));

    let countAllLinks = 0;
    let countFiles = 1;
    const allErrors = [];

    console.log(`Starting link checking`)
    const checks = files.map(async (file) => {
        const markdown = await readFile(file, { encoding: "utf8" });
        const links = markdownLinkExtractor(markdown, true);
        const countFileLinks = links.length;
        countAllLinks += countFileLinks;
        const checkFileLink = checkLink(cluster, stripRoot(file));
        const checks = links.map(checkFileLink);

        // Wait for all checks from file to complete before reporting on it
        const completeChecks = await Promise.allSettled(checks);

        console.log(`\n    ${countFiles++}) ${stripRoot(file)} has ${countFileLinks} links:`);

        completeChecks.forEach(({ value }) => {
            const { status, original, error } = value;
            if (status < 200 || status >= 300) {
                console.log(`        - [${redX}] ${status}: ${original}`);
                if (error) {
                    console.log(`\n                Puppeteer error:\n`, error);
                }
                allErrors.push(value);
            } else {
                console.log(`        - [✓] ${status}: ${original}`);
            }
        });
    });

    // Wait for everything to complete.
    const results = await Promise.allSettled(checks);

    /** Summary **/
    console.log(`\nSummary of errors:`);

    const asciiTable = new AsciiTable();

    asciiTable.setHeading("HTTP", "Link", "File");

    allErrors.forEach(({ status, original, file }) => {
        const row = [ status, summarizeLink(original), stripRoot(file) ]
        asciiTable.addRow(...row);
    });

    console.log(asciiTable.toString());
    console.log(separator);
    console.log(
        `Complete, counted ${countAllLinks} links in ${results.length} pages.
         ${allErrors.length} of ${countAllLinks} links resulted in errors.`);
    process.exit(0);
}

// getFiles is a simple promise wrapper for the "glob" callback signature
const getFiles = (pattern) => new Promise((resolve, reject) => {
    glob(pattern, (error, files) => {
        if (error) return reject(error);
        resolve(files);
    })
});

// Remove the beginning of the path, which is the root of the filesystem
// for this github action. The path will then be the relative path of the same
// file within the git repository.
const stripRoot = (path) => path.replace(new RegExp(`^${root}\\/`), "");

// Use the actual Internet to check if the given URL works.
const checkLink = (cluster, file) => async ({ href }) => {
    const original = href;
    let error;

    // If this is not a fully qualified URL, treat it like a relative path
    // within this directory
    if (! /^https?:\/\//.test(href))
        href = githubUrlFromPath(resolvePath(file, href));

    // First try puppeteer page nav, which throws if it fails
    try {
        const response = await cluster.execute(href);
        return { status: response.status(), original };
    } catch (puppeteerError) {
        // Do nothing, proceed with the fetch test
        error = puppeteerError;
    }

    // Puppeteer nav can fail for a variety of reasons. Try again with
    // a HEAD check
    const { status } = await fetch(href, {
        method: "HEAD",
        headers: {
            // Use headers to pretend to be a normal browser, to prevent false
            // negatives when sites try to block robots
            // From https://stackoverflow.com/a/54361485
            "Accept-Language": "en,en-US;q=0,5",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,/;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36"
        }
    });
    return { status, original, error };
};

// E.g. from: 'build_process/managing-node-with-brew.md', to: './node.md'
//      returns build_process/./node.md
const resolvePath = (from, to) => {
    // If "to" is absolute (starts with "/"), just use that
    if (/^\//.test(to)) return to;

    // Replace the last "/.*" path segment with the given relative one.
    return from.replace(/\/?[^/]+$/, `/${to}`);
}

// From a filepath, compose a URL to that file at this commit in this github repo
const githubUrlFromPath = (path) => {
    return `https://github.com/${repo}/blob/${sha}/${path}`;
}

// Pick a pretty separator for overly long strings
const summaryEllipsis = "......";
// Base the max size off a good looking string.
const summaryLinkMaxLength =
    ("https://d2mxu07abcdefg" + summaryEllipsis + "+at+2.24.55+PM.png").length;

// Splice some sort of ellipsis into really long links to make them shorter
const summarizeLink = (link) => {
    const len = link.length;
    if (len <= summaryLinkMaxLength) return link;
    const half = (summaryLinkMaxLength - summaryEllipsis.length) / 2;

    // "head of the original link" + "..." + "tail of the original link";
    return link.substring(0, half) + summaryEllipsis + link.substring(len - half);
}

// Start the async entrypoint
main();

#!/usr/bin/env node

const fetch = require("node-fetch");
const { Cluster } = require('puppeteer-cluster');
const markdownLinkExtractor = require('markdown-link-extractor');
const glob = require("glob");
const { promises: { readFile } } = require("fs");
const root = process.env.GITHUB_WORKSPACE;
const separator = "\n--------------------------------------------------\n";

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
    let countErrors = 0;
    let countFiles = 1;

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
        completeChecks.forEach(({ value: { status, original } }) => {
            if (status < 200 || status >= 300) {
                // Red colored unicode "x"
                console.log(`        - [\x1b[31m✖\x1b[0m] ${status}: ${original}`);
            } else {
                countErrors++;
                console.log(`        - [✓] ${status}: ${original}`);
            }
        });
    });

    // Wait for everything to complete.
    const results = await Promise.allSettled(checks);

    console.log(separator);
    console.log(
        `Complete, counted ${countAllLinks} links in ${results.length} pages.
         ${countErrors} of ${countAllLinks} links resulted in errors.`);
    process.exit(0);
}

// getFiles is a simple promise wrapper for the "glob" callback signature
const getFiles = (pattern) => new Promise((resolve, reject) => {
    glob(pattern, (error, files) => {
        if (error) return reject(error);
        resolve(files);
    })
});

const stripRoot = (path) => path.replace(new RegExp(`^${root}\\/`), "");

const checkLink = (cluster, file) => async ({ href }) => {
    const original = href;
    // If this is not a fully qualified URL, treat it like a relative path
    // within this directory
    if (! /^https?:\/\//.test(href))
        href = githubUrlFromPath(resolvePath(file, href));

    // First try puppeteer page nav, which throws if it fails
    try {
        const response = await cluster.execute(href);
        return { status: response.status(), original };
    } catch (error) {
        // Puppeteer nav can fail for a variety of reasons. Try again with
        // a HEAD check
        const { ok, status } = await fetch(href, { method: "HEAD" });
        return { status: status, original };
    }
};

// E.g. from: 'build_process/managing-node-with-brew.md', to: './node.md'
//      returns build_process/./node.md
const resolvePath = (from, to) => {
    // If "to" is absolute (starts with "/"), just use that
    if (/^\//.test(to)) return to;

    // Replace the last "/.*" path segment with the given relative one.
    return from.replace(/\/?[^/]+$/, `/${to}`);
}

const githubUrlFromPath = (path) => {
    const repo = process.env.GITHUB_REPOSITORY;
    const sha = process.env.GITHUB_SHA;
    return `https://github.com/${repo}/blob/${sha}/${path}`;
}

// Start the async entrypoint
main();

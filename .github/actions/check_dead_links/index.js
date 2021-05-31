#!/usr/bin/env node

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

    let countLinks = 0;
    let countErrors = 0;
    let countFiles = 1;

    console.log(`Starting link checking`)
    const checks = files.map(async (file) => {
        const markdown = await readFile(file, { encoding: "utf8" });
        const links = markdownLinkExtractor(markdown, true);
        const checks = links.map(async ({ href }) => {
            try {
                const response = await cluster.execute(href);
                return { status: response.status(), href };
            } catch (error) {
                return { error, href };
            }
        });

        // Wait for all checks from file to complete before reporting on it
        const completeChecks = await Promise.allSettled(checks);

        countLinks += links.length;

        console.log(`\n    ${countFiles++}) ${stripRoot(file)} has ${links.length} links:`);
        completeChecks.forEach(({ value: { error, status, href } }) => {
            if (error) countErrors++;

            console.log(`        - ${error || status}: ${href}`);
        });
    });

    // Wait for everything to complete.
    const results = await Promise.allSettled(checks);

    console.log(separator);
    console.log(
        `Complete, counted ${countLinks} links in ${results.length} pages.
         ${countErrors} of ${countLinks} links resulted in errors.`);
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

// Start the async entrypoint
main();

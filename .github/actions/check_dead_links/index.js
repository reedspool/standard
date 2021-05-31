#!/usr/bin/env node

const { Cluster } = require('puppeteer-cluster');
const markdownLinkExtractor = require('markdown-link-extractor');
const glob = require("glob");
const { fsPromises } = require("fs");
const { readFile } = fsPromises;
const root = process.env.GITHUB_WORKSPACE;
const clusterMaxConcurrent = 2;
const separator = "\n--------------------------------------------------\n";

async function main() {

    console.log(separator);
    console.log(`Searching ${root} for markdown files`);
    const files = await getAllMarkdownFiles(`${root}/**/*.md`);
    console.log(`All Markdown files:\n${files.map(stripRoot).join("\n")}`);
    console.log(separator);

    console.log(
        `Setup Puppeteer Cluster, max concurrency: ${clusterMaxConcurrent}`);

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_BROWSER,
        maxConcurrency: clusterMaxConcurrent,
    });

    // Define the only task for this cluster, whose input is a URL to check
    await cluster.task(async ({ page, data: url }) => {
      return page.goto(url);
    });

    let countLinks = 0;
    const checks = files.map((file) =>
        readFile(file, { encoding: "utf8" })
            .then(checkFileForDeadLinks(cluster))
            .then((links) => {
                countLinks += links.length;
                return { file, links };
            }));

    // Wait for everything to complete.
    const results = await Promise.all(checks);

    console.log(separator);
    console.log(`Results complete, counted ${countLinks} links in ${results.length} pages.`)

    results.forEach(({ file, links }, index) => {
        console.log(`\n    ${index + 1}) ${stripRoot(file)}:`);
        links.forEach(( link ) => {
            console.log(`        - ${link.status}: ${link.href}`);
        });
    });
}

const getAllMarkdownFiles = (pattern) => new Promise((resolve, reject) => {
    glob(pattern, (error, files) => {
        if (error) {
            reject(error);
            return;
        }

        resolve(files);
    })
});

const checkFileForDeadLinks = (cluster) => (markdown) => {
    const links = markdownLinkExtractor(markdown, true);
    const checks = links.map(({ href }) => cluster.execute(href));
    return Promise.all(checks);
};

const stripRoot = (path) => path.replace(new RegExp(`^${root}`), "");

// Start the async entrypoint
main();

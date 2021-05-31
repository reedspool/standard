#!/usr/bin/env node

const glob = require("glob");
const util = require("util");
const root = process.env.GITHUB_WORKSPACE;

async function main() {
    console.log(`Searching ${root} for markdown files`);
    const files = await getAllMarkdownFiles(`${root}/**/*.md`);
    console.log(`All Markdown files:\n${files.join("\n")}`);
}

const getAllMarkdownFiles = (pattern) => new Promise((resolve, reject) => {
    glob(pattern, (error, files) => {
        if (error) {
            reject(error);
            return;
        }

        resolve(files);
    })
})

// Start the async entrypoint
main();

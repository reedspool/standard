#!/usr/bin/env node

const glob = require("glob");
const root = process.env.GITHUB_WORKSPACE;

console.log("Searching ${root} for markdown files");

glob(`${root}/**/*.md`, (error, files) => {
    if (error) {
        console.log(`Error: ${error}`);
        return;
    }

    console.log("Markdown files:\n", files.join("\n"));
})

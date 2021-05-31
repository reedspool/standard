FROM ianwalter/puppeteer:v4.0.0
COPY ./index.js /index.js
COPY ./package.json /package.json
COPY ./package-lock.json /package-lock.json
RUN chmod +x /index.js \
    && npm install
ENTRYPOINT ["/index.js"]

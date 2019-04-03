#!/usr/bin/node --experimental-modules

import fs from 'fs';
import process from 'process';

import puppeteer from 'puppeteer';
import ArgumentParser from 'argparse';

async function take_screenshoot(browser, url) {
    const page = await browser.newPage();
    await page._client.send('Network.clearBrowserCookies');

    try {
        const response = await page.goto(url, {timeout: 3800, waitUntil: 'load'});

        const port = url.port
            ? url.port
            : (() => {
                switch (url.protocol) {
                    case 'http:':
                        return '80';
                    case 'https:':
                        return '443';
                }
            })()
        ;

        // await page.screenshot({path: `./${url.host}_${url.protocol.replace(':', '')}_${port}.png`, type: 'png'});

        const screenshot_data = await page.screenshot();

        console.log(`\x1b[32m${url.toString()}\x1b[0m`);

        return {
            request: {
                headers: response._request._headers,
                method: response._request._method,
                post_data: response._request._postData,
                url: response._request._url,
            },
            response: {
                ip: response._remoteAddress.ip,
                port: response._remoteAddress.port,
                url: response._url,
                headers: response._headers,
                status: response._status,
                status_text: response._statusText,
                response_data: await response.buffer()
            },
            screenshot_data: screenshot_data
        }
    } catch (err) {
        throw Error(`\x1b[33m${url.toString()}: ${err.toString()}\x1b[0m`);
    } finally {
        await page.close();
    }
}

function get_parser() {
    const parser = new ArgumentParser.ArgumentParser();

    parser.addArgument(
        [ '-o', '--output-dir' ],
        {
            help: 'The output directory where the screenshots are to be saved.',
            required: true,
            dest: 'output_dir'
        }
    );

    parser.addArgument(
        [ '-u', '--urls' ],
        {
            help: 'URLs to be visited and taken a screenshot of.',
            nargs: ArgumentParser.Const.ONE_OR_MORE,
            metavar: 'URL',
            dest: 'urls',
            defaultValue: []
        }
    );

    parser.addArgument(
        [ '-U', '--urls-file' ],
        {
            help: 'A list of files containing URLs to be visited and taken a screenshot of.',
            nargs: ArgumentParser.Const.ONE_OR_MORE,
            metavar: 'URL_FILE',
            dest: 'url_files',
            defaultValue: []
        }
    );

    parser.addArgument(
        [ '-n', '--num-concurrent' ],
        {
            help: 'Number of concurrent workers taking screenshots..',
            nargs: ArgumentParser.Const.ONE_OR_MORE,
            metavar: 'N',
            dest: 'num_concurrent',
            type: 'int',
            defaultValue: 5
        }
    );

    return parser;
}

(async () => {
    const args = get_parser().parseArgs();

    const url_stack = await (async () => {
        const url_set = new Set();

        for (const url_file of args.url_files) {
            const urls = (await fs.promises.readFile(url_file, 'utf8')).split('\n');
            urls.forEach(url => {
                const trimmed_url = url.trim();
                if (trimmed_url) {
                    url_set.add(trimmed_url);
                }
            });
        }

        args.urls.forEach(url => {
            const trimmed_url = url.trim();
            if (trimmed_url) {
                url_set.add(trimmed_url);
            }
        });

        // TODO: Fix read from stdin.

        return Array.from(url_set);
    })();

    const browser = await puppeteer.launch({headless: true, ignoreHTTPSErrors: true});
    const results = [];

    async function work() {
        while (url_stack.length > 0) {
            const url_str = url_stack.pop();
            if (!url_str)
                continue;

            try {
                results.push(await take_screenshoot(browser, new URL(url_str)));
            } catch (err) {
                console.error(err);
            }
        }
    }

    process.chdir(args.output_dir);
    await Promise.all(Array(args.num_concurrent).fill().map(() => work()));

    console.log(JSON.stringify(results));

    // for (let i = 0; i < url_arr.length; i += NUM_CONCURRENT) {
    //     const promises = url_arr.slice(i, i + NUM_CONCURRENT).map(url_str => ));
    //     let off = 0;
    //     for (const promise of promises) {
    //         console.log(`[${i+off+1}/${url_arr.length}] Trying ${url_arr[i+off]}...`);
    //         try {
    //             await promise;
    //         } catch (err) {
    //             console.error(err);
    //         }
    //         off++;
    //     }
    // }

    await browser.close();
})();


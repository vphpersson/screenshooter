#!/usr/bin/node --experimental-modules

import fs from 'fs';
import process from 'process';

import puppeteer from 'puppeteer';
import ArgumentParser from 'argparse';
import sharp from 'sharp';
import get_pixels from 'get-pixels';


function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function get_filename(input_url, ext) {
    const url = new URL(input_url);
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

    return `${url.host}_${url.protocol.replace(':', '')}_${port}.${ext}`;
}

async function get_num_colors(png_buffer) {
    const pixels = await new Promise((resolve => {
        get_pixels(png_buffer, 'image/png', (err, pixels) => {
            if (err)
                throw new Error(err);
            resolve(pixels);
        });
    }));
    return new Set(pixels.data).size;
}

async function take_screenshoot(browser, url) {
    const page = await browser.newPage();
    await page._client.send('Network.clearBrowserCookies');

    try {
        const response = await page.goto(url, {timeout: 3800, waitUntil: 'load'});

        return {
            url,
            timestamp: Date.now(),
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
                response_data_b64: (await response.buffer()).toString('base64')
            },
            screenshot_b64: (await (async () => {
                const screenshot_buffer = await page.screenshot();
                if (response.ok()) {
                    const resized_greyscale_screenshot_buffer = await sharp(screenshot_buffer)
                        .resize(9)
                        .greyscale()
                        .toBuffer()
                    ;
                    if (await get_num_colors(resized_greyscale_screenshot_buffer) < 15) {
                        await sleep(5000);
                        return page.screenshot();
                    }
                }
                return screenshot_buffer;
            })()).toString('base64')
        }
    } catch (err) {
        throw Error(`${url.toString()}: ${err.toString()}`);
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
            help: 'Number of concurrent workers taking screenshots.',
            metavar: 'N',
            dest: 'num_concurrent',
            type: 'int',
            defaultValue: 5
        }
    );

    return parser;
}

async function main() {
    const args = get_parser().parseArgs();

    process.chdir(args.output_dir);

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

    const num_urls = url_stack.length;
    const num_urls_num_digits = String(num_urls).length;
    let num_urls_requested = 0;

    const results = await (async () => {
        const results = [];

        async function work() {

            while (url_stack.length > 0) {
                const url_str = url_stack.pop();
                if (!url_str)
                    continue;

                const progress_str = `${String(++num_urls_requested).padStart(num_urls_num_digits, '0')}/${num_urls}`;

                try {
                    const take_screenshot_result = await take_screenshoot(browser, new URL(url_str));
                    const destination_path = `./${get_filename(take_screenshot_result.url, 'png')}`;
                    await fs.promises.writeFile(
                        destination_path,
                        Buffer.from(take_screenshot_result.screenshot_b64, 'base64')
                    );
                    console.log(`[${progress_str}] \x1b[32m${url_str}\x1b[0m`);
                    results.push(take_screenshot_result);
                } catch (err) {
                    console.error(`[${progress_str}] \x1b[33m${err.message}\x1b[0m`);
                }
            }
        }

        await Promise.all(Array(args.num_concurrent).fill().map(() => work()));

        return results;
    })();

    await browser.close();

    // console.log(JSON.stringify(results));
}

main()
    .then(() => {
        process.exit(0);
    })
    .catch(err => {
        console.error(err);
        process.exit(1);
    })
;
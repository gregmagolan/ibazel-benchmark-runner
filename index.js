#!/usr/bin/env node
// Copyright 2017 The Bazel Authors. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

const {spawn} = require('child_process');
const fs = require('fs');
const puppeteer = require('puppeteer');
const tempy = require('tempy');

const opts = require('nomnom').parse();

function runBenchmark() {
  if (!opts[0] || !opts[1]) {
    usage();
    process.exit(1);
  }

  const profileFilename = tempy.file({extension: 'json'});
  const runTarget = opts[0];
  const fileToTouch = opts[1];
  const browserUrl = opts.url;
  const config = opts.config;
  const initialTimeout = parseInt(opts.initial_timeout) || 300;
  const incrementalTimeout = parseInt(opts.incremental_timeout) || 60;
  const browserTimeout = parseInt(opts.browser_timeout) || 60;

  let isShutdown = false;

  log('Starting iBazel Benchmark Runner');
  log(`  profile_file: ${profileFilename}`)
  log(`  run_target: ${runTarget}`);
  log(`  filename: ${fileToTouch}`);
  if (browserUrl) {
    log(`  url: ${browserUrl}`);
  }
  log(`  initial_timeout: ${initialTimeout}s`);
  log(`  incremental_timeout: ${incrementalTimeout}s`);
  log(`  browser_timeout: ${browserTimeout}s`);
  if (config) {
    log(`  config: ${config}`);
  }

  log('Starting iBazel');
  const args = [];
  if (config) {
    args.push(`--config=${config}`)
  }
  args.push(`-profile_dev=${profileFilename}`, 'run', runTarget)
  const child =
      spawn('node_modules/.bin/ibazel', [`-profile_dev=${profileFilename}`, 'run', runTarget]);

  // Pipe iBazel output to console
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);

  function shutdown() {
    isShutdown = true;
    child.kill('SIGTERM');
    setTimeout(() => {
      log('iBazel did not shutdown');
      process.exit(1);
    }, 5000);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  function onShutdown(code, signal) {
    if (!isShutdown) {
      log(`iBazel process exited unexpectedly ${code} ${signal}`);
      process.exit(1);
    } else {
      process.exit()
    }
  }

  child.on('close', onShutdown);
  child.on('exit', onShutdown);

  // Wait for the initial build to finish
  waitForProfilerEvent(profileFilename, 'RUN_DONE', null, initialTimeout * 1000)
      .then((initialEvent) => {
        log(`Initial build time ${initialEvent.elapsed}ms`);
        return initialEvent;
      })
      .then((initialEvent) => {
        var browserPromise = Promise.resolve();
        if (browserUrl) {
          browserPromise = puppeteer.launch().then((browser) => {
            // Launch chrome and wait for browser to open page
            log('Launching chrome');
            return browser.newPage()
                .then((page) => {
                  log(`Navigating to ${browserUrl}`);
                  page.goto(browserUrl);
                })
                .then(
                    () => waitForProfilerEvent(
                        profileFilename, 'REMOTE_EVENT', null, browserTimeout * 1000))
          })
        }
        return browserPromise
            // Touch a file to start an incremental build
            .then(() => touchFile(fileToTouch))
            // Give the incremental build 10 seconds
            .then(
                () => waitForProfilerEvent(
                    profileFilename, 'RUN_DONE', initialEvent.iteration, incrementalTimeout * 1000))
            .then((incrementalEvent) => {
              log(`Incremental build RTT ${incrementalEvent.elapsed}ms`);
            })
            .then(() => {
              if (browserUrl) {
                return waitForProfilerEvent(
                           profileFilename, 'REMOTE_EVENT', initialEvent.iteration, browserTimeout * 1000)
                    .then((browserLoadEvent) => {
                      log(`Browser load RTT ${browserLoadEvent.elapsed}ms`);
                    });
              }
            })
      })
      .then(() => shutdown())
      .catch((err) => {
        log('Benchmark failed', err);
        shutdown();
      });
}

function log(msg, ...args) {
  console.log(`[ibazel-benchmark-runner] ${msg}`, ...args)
}

function touchFile(filename) {
  log(`Touching file ${filename}`);
  fs.appendFileSync(filename, '\n');
}

function waitForProfilerEvent(filename, eventType, ignoreIteration, timeout) {
  log(`Waiting for ${eventType} event...`);
  const start = Date.now();
  return new Promise((fulfill, reject) => {
    const interval = setInterval(() => {
      if (fs.existsSync(filename)) {
        const lines = compact(fs.readFileSync(filename).toString().split('\n'));
        while (lines.length) {
          try {
            const event = JSON.parse(lines.pop());
            if (event.type === eventType) {
              if (!ignoreIteration || ignoreIteration !== event.iteration) {
                log(`Found ${eventType}`);
                clearInterval(interval);
                fulfill(event);
              }
            }
          } catch (e) {
            log('Failed to parse profile output');
          }
        }
      }
      const elapsed = Date.now() - start;
      if (elapsed > timeout) {
        reject('Timeout exceeed');
      }
    }, 250);
  })
}

function usage() {
  console.log(`iBazel Benchmark Runner

Usage:
  ibazel-benchmark-runner <run_target> <file_to_modify> [--url=<url>] [--initial_timeout=<seconds>] [--incremental_timeout=<seconds>]

Arguments:
  run_target: the bazel target to run
  file_to_modify: the file to modify in order to start in incremental build (a newline will be added to the end of this file)
  url: url for the benchmark to navigate to in order to measure browser interactive RTT for incremental build (optional)
  initial_timeout: maximum time to wait for the initial build (defaults to 300 seconds)
  incremental_timeout: maximum time to wait for the incremental build (defaults to 60 seconds)
  browser_timeout: maximum time to wait for browser page load event (defaults to 60 seconds)

Example:
  ibazel-benchmark-runner //src:devserver src/foo/bar.ts --url=http://localhost:5432
`)
}

function compact(a) {
  return a.filter((e) => e !== (undefined || null || ''));
}

runBenchmark();

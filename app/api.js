/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2026 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* --- BEGIN API --- */

/**
 * SIPD Penatausahaan Bridge main application.
 *
 * @typedef {Object} SipdApi
 * @property {string} title Application title
 * @property {SipdAboutInfo} about Application information
 * @property {string} proto Protocol version
 * @property {string} mode Bridge mode
 * @property {object} config Configuration
 * @property {SipdBridge[]} bridges Bridges
 * @property {AuthenticateFunction} authenticate Perform usename and password authentication
 * @property {PagedObjectsPromiseFunction} getQueues Get queues
 * @property {StringPromiseFunction} getActivity Get activity logs
 * @property {ObjectPromiseFunction} getCount Get activity count
 * @property {PagedObjectsPromiseFunction} getErrors Get captured errors
 */

/**
 * SIPD Penatausahaan Bridge queue consumer.
 *
 * @typedef {Object} SipdBridge
 * @property {string} name Name
 * @property {number} year Year
 * @property {ObjectPromiseFunction} getStats Get bridge stats
 * @property {StringPromiseFunction} getLogs Get bridge logs
 * @property {ObjectPromiseFunction} getLast Get last queue
 * @property {ObjectPromiseFunction} getCurrent Get current processing queue
 */

/**
 * Application information.
 *
 * @typedef {Object} SipdAboutInfo
 * @property {string} title Title
 * @property {string} version Version
 * @property {string} author Author name and email address
 * @property {string} license License, e.g. MIT License
 */

/**
 * Perform usename and password authentication.
 *
 * @callback AuthenticateFunction
 * @param {string} username Username
 * @param {string} password Password
 * @returns {boolean}
 */

/**
 * A function which returns paged objects Promise.
 *
 * @callback PagedObjectsPromiseFunction
 * @param {number} page Page number
 * @param {number} size Page size
 * @returns {Promise<object[]>}
 */

/**
 * A function which returns object Promise.
 *
 * @callback ObjectPromiseFunction
 * @returns {Promise<object>}
 */

/**
 * A function which returns string Promise.
 *
 * @callback StringPromiseFunction
 * @returns {Promise<string>}
 */

/* --- END API --- */

const fs = require('fs');
const path = require('path');
const SipdQueue = require('./queue');
const SipdLogger = require('../sipd/logger');
const SipdUtil = require('../sipd/util');
const { glob } = require('glob');

/**
 * Main api.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Api {

    sockets = []

    /**
     * Constructor.
     *
     * @param {import('.')} app Application
     */
    constructor(app) {
        // generate default credential
        if (app.config.security === undefined) {
            app.config.security = {};
        }
        if (!app.config.security.username) {
            app.config.security.username = 'admin';
            console.log(`Web interface username using default: ${app.config.security.username}`);
        }
        if (!app.config.security.password) {
            app.config.security.password = SipdUtil.genId();
            console.log(`Web interface password generated: ${app.config.security.password}`);
        }
        // load application information
        const packageInfo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json')));
        // published properties
        this.title = 'SIPD Penatausahaan Bridge';
        this.about = {
            title: packageInfo.description,
            version: packageInfo.version,
            author: packageInfo.author.name ? `${packageInfo.author.name} <${packageInfo.author.email}>` :
                packageInfo.author,
            license: packageInfo.license
        }
        this.proto = app.VERSION;
        this.mode = app.config.mode.toUpperCase();
        this.bridges = app.bridges.map(bridge => new ApiBridge(app, bridge));
        this.authenticate = (username, password) => {
            return username === app.config.security.username && password === app.config.security.password ?
                true : false;
        }
        this.getQueues = async (page, size) => {
            const queues = app.dequeue.getLogs(SipdQueue.LOG_RAW)
                .reverse();
            const res = {
                count: queues.length,
                page: page ?? 1,
                size: size ?? 25,
                items: [],
            }
            if (queues.length) {
                let start = (res.page - 1) * res.size;
                res.items.push(...(queues
                    .slice(start, start + res.size))
                    .map(data => ({nr: ++start, ...data})));
            }
            return res;
        }
        this.getActivity = async () => {
            let res, filename = SipdLogger.getLogFile(SipdLogger.LOG_ACTIVITY);
            if (filename && fs.existsSync(filename)) {
                res = fs.readFileSync(filename).toString();
            }
            return res;
        }
        this.getCount = async () => {
            const res = {};
            const stat = (key, label, values) => (res[key] = {label, value: values.length});
            stat('queue', 'Total unprocessed queue', app.dequeue.queues);
            stat('processing', 'Total processing queue', app.dequeue.processing);
            return res;
        }
        this.getErrors = async (page, size) => {
            const res = {
                count: 0,
                page: page ?? 1,
                size: size ?? 10,
                items: [],
            }
            const captureDir = path.join(app.config.workdir, app.config.capturedirname);
            if (fs.existsSync(captureDir)) {
                const files = await glob(path.join(captureDir, '*.png'), {
                    withFileTypes: true,
                    windowsPathsNoEscape: true,
                });
                if (files.length) {
                    files.reverse();
                    let nr = (res.page - 1) * res.size;
                    for (const file of files) {
                        res.count++;
                        if (res.count === nr + 1) {
                            nr++;
                            const filename = path.join(file.path, file.name);
                            const errFilename = path.join(file.path, file.name.substr(0, file.name.lastIndexOf('.')) + '.err');
                            const dataFilename = path.join(file.path, file.name.substr(0, file.name.lastIndexOf('.')) + '.json');
                            if (fs.existsSync(errFilename) && fs.existsSync(dataFilename)) {
                                res.items.push({
                                    nr,
                                    filename: file.name,
                                    image: `data:image/png;base64,${fs.readFileSync(filename).toString('base64')}`,
                                    error: fs.readFileSync(errFilename).toString(),
                                    data: fs.readFileSync(dataFilename).toString(),
                                });
                            }
                        }
                    }
                }
            }
            return res;
        }
        this.config = app.config;
    }

    handle(socket) {
        if (!this.sockets.includes(socket)) {
            this.sockets.push(socket);
        }
        console.log('UI Client connected: %s', socket.id);
        socket.on('disconnect', () => {
            console.log('UI Client disconnected: %s', socket.id);
            const idx = this.sockets.indexOf(socket);
            if (idx >= 0) {
                this.sockets.splice(idx, 1);
            }
        });
    }

    notify(status, data = {}) {
        for (const socket of this.sockets) {
            socket.emit(status, data);
        }
    }
}

/**
 * Api bridge.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ApiBridge {

    /**
     * Constructor.
     *
     * @param {import('.')} app Application
     * @param {import('../bridge')} bridge Bridge
     */
    constructor(app, bridge) {
        this.name = bridge.name;
        this.year = bridge.year;
        this.getLogs = async () => {
            let res, filename = SipdLogger.getLogFile(bridge.name);
            if (filename && fs.existsSync(filename)) {
                res = fs.readFileSync(filename).toString();
            }
            return res;
        }
        this.getStats = async () => {
            const res = {};
            const stat = (key, label, values) => (res[key] = {label, value: values.length});
            const queues = [...app.dequeue.completes, ...app.dequeue.processing]
                .filter(q => q.bridge === bridge);
            stat('total', 'Total queue', queues);
            stat('success', 'Total successful', queues.filter(q => q.status === SipdQueue.STATUS_DONE));
            stat('fail', 'Total unsuccessful', queues.filter(q => ![SipdQueue.STATUS_PROCESSING, SipdQueue.STATUS_DONE]
                .includes(q.status)));
            return res;
        }
        this.getLast = async () => {
            const queues = app.dequeue.completes
                .filter(q => q.bridge === bridge);
            if (queues.length) {
                return queues.pop();
            }
        }
        this.getCurrent = async () => {
            if (bridge.queue && bridge.queue.status === SipdQueue.STATUS_PROCESSING) {
                return bridge.queue;
            }
        }
    }
}

module.exports = Api;

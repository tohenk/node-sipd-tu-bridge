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

const fs = require('fs');
const path = require('path');
const SipdLogger = require('../sipd/logger');
const SipdQueue = require('./queue');
const SipdUtil = require('../sipd/util');
const { Socket } = require('socket.io');
const { glob } = require('glob');

/* --- BEGIN API V1 --- */

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
 * @property {PagedObjectsFunction} getQueues Get queues
 * @property {ActivityFunction} getActivity Get activity logs
 * @property {ObjectFunction} getCount Get activity count
 * @property {PagedObjectsFunction} getErrors Get captured errors
 * @property {QueryFunction} query Perform API query
 */

/**
 * SIPD Penatausahaan Bridge queue consumer.
 *
 * @typedef {Object} SipdBridge
 * @property {string} name Name
 * @property {number} year Year
 * @property {ObjectFunction} getStats Get bridge stats
 * @property {ActivityFunction} getLogs Get bridge logs
 * @property {LogFilesFunction} getLogFiles Get bridge addiitonal log files
 * @property {ObjectFunction} getLast Get last queue
 * @property {ObjectFunction} getCurrent Get current processing queue
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
 * Get objects at specified page with size of limit. If none specified
 * it returns first page with default size limit (either 10 or 25).
 *
 * @callback PagedObjectsFunction
 * @param {?number} page Page number
 * @param {?number} size Page size
 * @returns {Promise<object[]>}
 */

/**
 * Get miscellanous object such as queue or log.
 *
 * @callback ObjectFunction
 * @returns {Promise<object>}
 */

/**
 * Get string content such as activity logs.
 *
 * @callback ActivityFunction
 * @param {?string} seq Sequence number
 * @returns {Promise<string>}
 */

/**
 * Query api and return result object.
 *
 * @callback QueryFunction
 * @param {object} data Query data
 * @returns {Promise<object>}
 */

/**
 * Get additional log files.
 *
 * @callback LogFilesFunction
 * @returns {Promise<[{name: string, seq: string, time: number}]>}
 */

/* --- END API --- */

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
            app.config.security.password = SipdUtil.genId(10);
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
        /** @type {AuthenticateFunction} */
        this.authenticate = (username, password) => {
            return username === app.config.security.username && password === app.config.security.password ?
                true : false;
        }
        /** @type {PagedObjectsFunction} */
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
        /** @type {ActivityFunction} */
        this.getActivity = async (seq) => {
            return ApiFn.getLogs(SipdLogger.LOG_ACTIVITY, seq);
        }
        /** @type {ObjectFunction} */
        this.getCount = async () => {
            const res = {};
            ApiFn.stat(res, 'queue', 'Total unprocessed queue', app.dequeue.queues);
            ApiFn.stat(res, 'processing', 'Total processing queue', app.dequeue.processing);
            return res;
        }
        /** @type {PagedObjectsFunction} */
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
                    const part = file => {
                        return file.name.substr(0, file.name.lastIndexOf('.')).split('-');
                    }
                    const cmp = (a, b) => {
                        const aa = part(a), bb = part(b);
                        const a1 = aa.pop(), b1 = bb.pop();
                        return b1.localeCompare(a1) || aa.join('-').localeCompare(bb.join('-'));
                    }
                    files.sort((a, b) => cmp(a, b));
                    let nr = (res.page - 1) * res.size;
                    for (const file of files) {
                        res.count++;
                        if (res.count === nr + 1) {
                            nr++;
                            const filename = path.join(file.parentPath, file.name);
                            const errFilename = path.join(file.parentPath, file.name.substr(0, file.name.lastIndexOf('.')) + '.err');
                            const dataFilename = path.join(file.parentPath, file.name.substr(0, file.name.lastIndexOf('.')) + '.json');
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
        /** @type {QueryFunction} */
        this.query = async (data) => {
            const res = {success: false};
            switch (data.cmd) {
                case 'activity-seq':
                    res.success = true;
                    res.sequences = ApiFn.getLogFiles(SipdLogger.LOG_ACTIVITY);
                    break;
                case 'log-file':
                    if (data.seq) {
                        res.success = true;
                        res.logs = ApiFn.getLogs(data.log ?? SipdLogger.LOG_ACTIVITY, data.seq);
                    }
                    break;
                case 'remove-queue':
                    if (data.queue) {
                        const queue = app.dequeue.queues.find(q => q.id === data.queue);
                        if (queue) {
                            res.success = true;
                            app.dequeue.queues.splice(app.dequeue.queues.indexOf(queue), 1);
                            this.notify('queue');
                        }
                    }
                    break;
                case 'clean-err':
                    if (data.error) {
                        const errGlob = path.join(
                            app.config.workdir,
                            app.config.capturedirname,
                            data.error.substr(0, data.error.lastIndexOf('.') + 1) + '*'
                        );
                        const files = await glob(errGlob, {
                            withFileTypes: true,
                            windowsPathsNoEscape: true,
                        });
                        if (files.length) {
                            for (const file of files) {
                                fs.rmSync(file.fullpath(), {force: true});
                            }
                            res.success = true;
                        }
                    }
                    break;
                case 'restart':
                    if (app.config.restart && this.restarting === undefined) {
                        this.restarting = true;
                        console.log('Application restart requested, exiting...');
                        setTimeout(() => process.kill(process.pid, 'SIGINT'), 10000);
                        this.notify('restart');
                        res.success = true;
                    }
                    break;
            }
            return res;
        }
        this.config = app.config;
    }

    /**
     * Handle client connection.
     *
     * @param {Socket} socket Client connection
     */
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

    /**
     * Notify client connection.
     *
     * @param {string} status Event name
     * @param {object} data Event data
     */
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
        /** @type {ActivityFunction} */
        this.getLogs = async (seq) => {
            return ApiFn.getLogs(bridge.name, seq);
        }
        /** @type {LogFilesFunction} */
        this.getLogFiles = async () => {
            return ApiFn.getLogFiles(bridge.name);
        }
        /** @type {ObjectFunction} */
        this.getStats = async () => {
            const res = {};
            const queues = [...app.dequeue.completes, ...app.dequeue.processing]
                .filter(q => q.bridge === bridge);
            ApiFn.stat(res, 'total', 'Total queue', queues);
            ApiFn.stat(res, 'success', 'Total successful', queues.filter(q => q.status === SipdQueue.STATUS_DONE));
            ApiFn.stat(res, 'fail', 'Total unsuccessful', queues.filter(q => ![SipdQueue.STATUS_PROCESSING, SipdQueue.STATUS_DONE]
                .includes(q.status)));
            return res;
        }
        /** @type {ObjectFunction} */
        this.getLast = async () => {
            const queues = app.dequeue.completes
                .filter(q => q.bridge === bridge);
            if (queues.length) {
                return queues.pop();
            }
        }
        /** @type {ObjectFunction} */
        this.getCurrent = async () => {
            if (bridge.queue && bridge.queue.status === SipdQueue.STATUS_PROCESSING) {
                return bridge.queue;
            }
        }
    }
}

/**
 * Api function helper.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ApiFn {

    /**
     * Add statistical value.
     *
     * @param {object} res Result object
     * @param {string} key Key name
     * @param {string} label Key label
     * @param {any[]} values Values
     */
    static stat(res, key, label, values) {
        res[key] = {label, value: values.length};
    }

    /**
     * Get activity logs.
     *
     * @param {string} log Log name
     * @param {?string} seq Sequence number
     * @returns {string}
     */
    static getLogs(log, seq) {
        let res, filename = SipdLogger.getLogFile(log);
        if (seq) {
            filename += `.${seq}`;
        }
        if (filename && fs.existsSync(filename)) {
            res = fs.readFileSync(filename).toString();
        }
        return res;
    }

    /**
     * Get log file sequences.
     *
     * @param {string} log Log name
     * @returns {object[]}
     */
    static async getLogFiles(log) {
        log = SipdLogger.getLogFile(log);
        const files = await glob(`${log}.*`, {
            stat: true,
            withFileTypes: true,
            windowsPathsNoEscape: true,
        });
        return files
            .map(file => ({
                name: file.ctime.toJSON().substr(0, 10),
                seq: file.name.substr(file.name.lastIndexOf('.') + 1),
                time: file.ctime.getTime(),
            }))
            .sort((a, b) => b.time - a.time);
    }
}

module.exports = Api;

/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

const debug = require('debug');
const fs = require('fs');
const path = require('path');
const Logger = require('@ntlab/ntlib/logger');

/**
 * SIPD logger.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdLogger {

    /**
     * Get logger function.
     *
     * @param {string} tag Log tag
     * @param {*} options Log options
     * @returns {Function}
     */
    static logger(tag, options) {
        if (this.factory === undefined) {
            throw new Error('Logger is not created yet, make sure create() is called first!');
        }
        return this.factory(tag, options || {});
    }

    /**
     * Create file logger.
     *
     * @param {string} tag Log tag
     * @param {object} options Log options
     * @returns {Function}
     */
    static fileLogger(tag, options) {
        if (this._loggers === undefined) {
            this._loggers = {};
        }
        const defaults = this.getDefaults(this.FILE);
        const logTag = options.tag ?? (defaults.tag ?? 'sipd');
        if (this._loggers[logTag] === undefined) {
            const logDir = defaults.logdir || path.resolve(path.join(__dirname, '..', 'logs'));
            const logFile = path.join(logDir, `${logTag}.log`);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, {recursive: true});
            }
            const logger = new Logger(logFile);
            this._loggers[logTag] = {
                logger,
                log: (...args) => logger.log(...args)
            }
        }
        this._loggers[logTag].logger.tag = [options.role, options.action, tag].filter(Boolean);
        return this._loggers[logTag].log;
    }

    /**
     * Create debug logger.
     *
     * @param {string} tag Debug tag
     * @param {object} options Debug options
     * @returns {Function}
     */
    static debugLogger(tag, options) {
        const defaults = this.getDefaults(this.DEBUG);
        const logTag = options.tag ?? (defaults.tag ?? 'sipd');
        return debug([options.tag ?? logTag, options.role, options.action, tag].filter(Boolean).join(':'));
    }

    /**
     * Create logger function.
     *
     * @param {string} logger Logger name
     */
    static create(logger) {
        this.factory = {
            [this.FILE]: this.fileLogger,
            [this.DEBUG]: this.debugLogger,
        }[logger];
    }

    /**
     * Get logger default options.
     *
     * @param {string} logger Logger name
     * @returns {object}
     */
    static getDefaults(logger) {
        return this._defaults !== undefined && this._defaults[logger] ? this._defaults[logger] : {};
    }

    /**
     * Set logger default options.
     *
     * @param {string} logger Logger name
     * @param {object} defaults Logger options
     */
    static setDefaults(logger, defaults) {
        if (this._defaults === undefined) {
            this._defaults = {};
        }
        this._defaults[logger] = defaults;
        return this;
    }

    static get DEBUG() { return 'debug' }
    static get FILE() { return 'file' }
}

module.exports = SipdLogger;
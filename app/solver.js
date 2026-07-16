/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2026 Toha <tohenk@yahoo.com>
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
const io = require('socket.io-client');
const SipdLogger = require('./sipd/logger');
const SipdUtil = require('./sipd/util');
const { SipdTimer } = require('./sipd');

const dtag = 'solver';

/**
 * Captcha solver service.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Solver {

    /**
     * Constructor.
     *
     * @param {object} config Configuration
     */
    constructor(config) {
        this.config = config;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Create solver function.
     *
     * @param {object} config Configuration
     * @returns {Function|undefined}
     */
    static create(config) {
        let solver;
        for (const SolverClass of [MockSolver, CliSolver, SocketSolver]) {
            if (SolverClass.canHandle(config)) {
                SipdLogger.activity(dtag)(`Captcha solver is handled by ${SolverClass.name}...`);
                solver = new SolverClass(config);
                break;
            }
        }
        if (solver) {
            return (captcha, options) => solver.solve(captcha, options);
        }
    }
}

/**
 * Captcha solver using CLI.
 *
 * Configuration example:
 * ```json
 * {
 *     "captchaSolver": {
 *         "bin": "python",
 *         "args": ["/path/to/solver.py", "%CAPTCHA%"]
 *     }
 * }
 * ```
 *
 * @author Toha <tohenk@yahoo.com>
 */
class CliSolver extends Solver {

    initialize() {
        this.cmd = require('@ntlab/ntlib/command')(this.config, {});
    }

    /**
     * Get captcha solver works.
     *
     * @param {Buffer} captcha Captcha data
     * @param {object} options Options
     * @returns {array}
     */
    solve(captcha, options) {
        return [
            [x => this.saveCaptcha(captcha, options.dir)],
            [x => this.solveCaptcha(x.getRes(0)), x => x.getRes(0)],
        ];
    }

    /**
     * Save captcha image to file.
     *
     * @param {string} data Image data
     * @param {string} dir Working directory
     * @returns {Promise<string>}
     */
    saveCaptcha(data, dir) {
        let res;
        const content = SipdUtil.getMimeContent(data, true);
        if (content.data) {
            const filename = content.checksum + '.' + (content.mimetype.indexOf('png') > 0 ? 'png' : 'jpg');
            res = path.join(dir, filename);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, {recursive: true});
            }
            if (fs.existsSync(dir)) {
                fs.writeFileSync(res, content.data);
            }
        }
        return Promise.resolve(res);
    }

    /**
     * Solve saved captcha.
     *
     * @param {string} filename Captcha filename
     * @returns {Promise<string>}
     */
    solveCaptcha(filename) {
        if (filename && fs.existsSync(filename)) {
            return new Promise((resolve, reject) => {
                let stdout, stderr;
                const p = this.cmd.exec({CAPTCHA: filename});
                p.stdout.on('data', line => {
                    if (stdout === undefined) {
                        stdout = line;
                    } else {
                        stdout = Buffer.concat([stdout, line]);
                    }
                });
                p.stderr.on('data', line => {
                    if (stderr === undefined) {
                        stderr = line;
                    } else {
                        stderr = Buffer.concat([stderr, line]);
                    }
                });
                p.on('exit', code => {
                    if (fs.existsSync(filename)) {
                        fs.rmSync(filename);
                    }
                    let res;
                    if (stdout) {
                        res = stdout.toString().trim();
                    }
                    resolve(res);
                });
                p.on('error', err => {
                    reject(err);
                });
            });
        }
        return Promise.resolve();
    }

    /**
     * Check if solver can handle given configuration?
     *
     * @param {object} config Configuration
     * @returns {boolean}
     */
    static canHandle(config) {
        return typeof config === 'object' && config.bin !== undefined;
    }
}

/**
 * Captcha solver using socket.io.
 *
 * Configuration example:
 * ```json
 * {
 *     "captchaSolver": {
 *         "url": "http://localhost:4001",
 *         "options": {
 *             "token": "my-token"
 *         }
 *     }
 * }
 * ```
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SocketSolver extends Solver {

    initialize() {
        this.ready = false;
        /** @type {io.Socket} */
        this.ns = this.createSocketClient(this.config);
        this.ns
            .on('connect', () => {
                this.ready = true;
                SipdLogger.activity(dtag)(`Connected to SocketSolver at ${this.url}...`);
            })
            .on('disconnect', () => {
                this.ready = false;
                SipdLogger.activity(dtag)(`Disonnected from SocketSolver at ${this.url}...`);
            });
    }

    /**
     * Create socket.io client.
     *
     * @param {object} params Parameters
     * @returns {io.Socket}
     */
    createSocketClient(params) {
        this.url = params.url;
        if (this.url) {
            const options = params.options || {};
            // guess socket io path automatically
            if (!options.path) {
                const url = new URL(this.url);
                const path = url.pathname
                    .split('/')
                    .filter(a => a.length);
                if (path.length > 1) {
                    // remove namespace
                    const ns = path.pop();
                    // set socket.io path
                    options.path = `/${path.join('/')}/socket.io/`;
                    // update socket url
                    url.pathname = `/${ns}`;
                    this.url = url.toString();
                }
            }
            if (params.token) {
                if (!options.extraHeaders) {
                    options.extraHeaders = {};
                }
                options.extraHeaders.Authorization = `Bearer ${params.token}`;
            }
            return io(this.url, options);
        } else {
            throw new Error('Unable to create socket client without url!');
        }
    }

    /**
     * Get captcha solver works.
     *
     * @param {Buffer} captcha Captcha data
     * @param {object} options Options
     * @returns {array}
     */
    solve(captcha, options) {
        return [
            [x => this.waitForReady()],
            [x => this.sendCaptcha(captcha)],
        ];
    }

    /**
     * Wait for socket.io connection to be ready.
     *
     * @returns {Promise<undefined>}
     */
    waitForReady() {
        return new Promise((resolve, reject) => {
            const timer = new SipdTimer({delta: 60});
            const f = () => {
                if (this.ready) {
                    resolve();
                } else {
                    timer.check(t => SipdLogger.activity(dtag)(`Still waiting socket ${this.url} to be ready after ${t.elapsedTime}...`));
                    setTimeout(f, 100);
                }
            }
            f();
        });
    }

    /**
     * Send captcha image to solver.
     *
     * @param {string} captcha Captcha image data
     * @returns {Promise<string>}
     */
    sendCaptcha(captcha) {
        return new Promise((resolve, reject) => {
            const content = SipdUtil.getMimeContent(captcha);
            if (content.data) {
                this.ns.emit('solve', {model: 'sipd', data: content.data}, res => {
                    resolve(res.captcha ?? undefined);
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Check if solver can handle given configuration?
     *
     * @param {object} config Configuration
     * @returns {boolean}
     */
    static canHandle(config) {
        return typeof config === 'object' && config.url !== undefined;
    }
}

/**
 * Captcha solver mock.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class MockSolver extends Solver {

    /**
     * Get captcha solver works.
     *
     * @param {Buffer} captcha Captcha data
     * @param {object} options Options
     * @returns {array}
     */
    solve(captcha, options) {
        const max = 1e6;
        return [
            [x => Promise.resolve(Math.floor(Math.random() * max).toString().padStart(6, '0'))],
        ];
    }

    /**
     * Check if solver can handle given configuration?
     *
     * @param {object} config Configuration
     * @returns {boolean}
     */
    static canHandle(config) {
        return process.env.CAPTCHA_SOLVER_MOCK ? true : false;
    }
}

module.exports = Solver;

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
const { Socket } = require('socket.io');

/**
 * Sipd command handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCmd {

    /** @type {string} */
    name = null
    /** @type {string} */
    mode = null
    /** @type {object} */
    parent = null
    /** @type {import('../app/configuration')} */
    config = null
    /** @type {import('../app/queue').DEQUEUE} */
    dequeue = null

    /**
     * Constructor.
     *
     * @param {string} name Command name
     * @param {object} options Options
     * @param {import('../app/queue').DEQUEUE} options.dequeue Dequeue
     * @param {object} options.parent Parent
     */
    constructor(name, options) {
        this.name = name;
        this.parent = options.parent;
        this.config = options.config || this.parent.config;
        this.dequeue = options.dequeue;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Check if handler can consume data.
     *
     * @param {object} payload Data payload
     * @param {object} data Data values
     * @param {Socket} socket Client socket
     * @returns {boolean}
     */
    validate(payload) {
        return true;
    }

    /**
     * Consume data.
     *
     * @param {object} payload Data payload
     * @param {object} data Data values
     * @param {Socket} socket Client socket
     * @returns {object}
     */
    consume(payload) {
    }

    /**
     * Create an error message.
     *
     * @param {string|Error} message Message
     * @returns {object}
     */
    createError(message) {
        return {error: message instanceof Error ? message.message : message};
    }

    /**
     * Set command owner.
     *
     * @param {import('../app')} app Application
     */
    static setApp(app) {
        this.app = app;
        return this;
    }

    /**
     * Set command directory location.
     *
     * @param {string} dir Directory
     */
    static setDir(dir) {
        this.dir = dir;
        return this;
    }

    /**
     * Scan and register commands.
     *
     * @param {string} mode Bridge mode
     * @param {string|string[]} name Name prefix
     * @param {string|string[]} dirname Directory name
     * @param {boolean} recursive If true, process sub directory as well
     */
    static register(mode = null, name = null, dirname = null, recursive = null) {
        if (this.app === undefined) {
            throw new Error('Application is not set!');
        }
        if (this.dir === undefined) {
            this.dir = __dirname;
        }
        name = this.makeArray(name);
        dirname = this.makeArray(dirname);
        const dir = path.join(this.dir, ...dirname);
        const f = entry => entry.isFile() ? 0 : 1;
        const entries = fs.readdirSync(dir, {withFileTypes: true})
            .sort((a, b) => f(a) - f(b));
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (recursive) {
                    this.register(mode, [...name, entry.name], [...dirname, entry.name], true);
                }
            } else if (entry.name.endsWith('.js')) {
                const cmd = entry.name.substr(0, entry.name.length - 3);
                if (cmd !== 'index') {
                    const cmdname = [...name, cmd].join(':');
                    if (!this.get(cmdname)) {
                        /** @type {typeof SipdCmd} */
                        const CmdClass = require(path.join(dir, cmd));
                        const CmdInstance = new CmdClass(cmdname, {parent: this.app, dequeue: this.app.dequeue});
                        if (mode) {
                            CmdInstance.mode = mode;
                        }
                        this.commands.push(CmdInstance);
                        console.log(`Command ${cmdname} registered`);
                    } else {
                        console.error(`Command ${cmdname} already registered!`);
                    }
                }
            }
        }
        return this;
    }

    /**
     * Get registered command.
     *
     * @param {string} name Name
     * @returns {SipdCmd}
     */
    static get(name) {
        for (const cmd of this.commands) {
            if (cmd.name === name) {
                return cmd;
            }
        }
    }

    /**
     * Handle socket connection.
     * 
     * @param {Socket} socket Client socket
     */
    static handle(socket) {
        for (const cmd of this.commands) {
            socket.on(cmd.name, data => {
                if (cmd.validate({socket, data})) {
                    const result = cmd.consume({socket, data});
                    if (result) {
                        if (result instanceof Promise) {
                            result
                                .then(res => socket.emit(cmd.name, res))
                                .catch(err => socket.emit(cmd.name, err));
                        } else {
                            socket.emit(cmd.name, result);
                        }
                    }
                }
            });
        }
    }

    /**
     * Get available commands.
     *
     * @returns {SipdCmd[]}
     */
    static get commands() {
        if (!this._commands) {
            this._commands = [];
        }
        return this._commands;
    }

    /**
     * Make array.
     *
     * @param {any|any[]} array Array
     * @returns {any[]}
     */
    static makeArray(array) {
        return (Array.isArray(array) ? array : [array])
            .filter(Boolean);
    }
}

module.exports = SipdCmd;
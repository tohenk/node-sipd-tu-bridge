/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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
const Configuration = require('../app/configuration');
const { Socket } = require('socket.io');
const { SipdDequeue } = require('../app/queue');
const debug = require('debug')('sipd:cmd');

/**
 * Sipd command handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCmd {

    /** @var {string} */
    name = null
    /** @var {object} */
    parent = null
    /** @var {Configuration} */
    config = null
    /** @var {SipdDequeue} */
    dequeue = null

    /**
     * Constructor.
     *
     * @param {string} name Command name
     * @param {object} options Options
     * @param {SipdDequeue} options.dequeue Dequeue
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
     * Register commands.
     *
     * @param {object} owner Owner
     * @param {string} prefix Command prefix
     * @param {string|undefined} dir The directory
     * @param {string[]|undefined} ns The namespaces
     */
    static register(owner, prefix, dir, ns) {
        dir = dir || __dirname;
        const f = entry => entry.isFile() ? 0 : 1;
        const entries = fs.readdirSync(dir, {withFileTypes: true})
            .sort((a, b) => f(a) - f(b));
        ns = (Array.isArray(ns) ? ns : [ns]).filter(Boolean);
        for (const entry of entries) {
            if (entry.isDirectory()) {
                this.register(owner, prefix, path.join(dir, entry.name),
                    [...ns, entry.name !== 'all' ? entry.name : null].filter(Boolean));
            } else if (entry.name.endsWith('.js')) {
                const cmd = entry.name.substr(0, entry.name.length - 3);
                if (cmd !== 'index') {
                    const name = [...ns, cmd].join(':');
                    if (!this.get(name)) {
                        if (!prefix || name.indexOf(':') < 0 || (prefix && name.startsWith(prefix + ':'))) {
                            const CmdClass = require(path.join(dir, cmd));
                            const CmdInstance = new CmdClass(name, {parent: owner, dequeue: owner.dequeue});
                            this.commands.push(CmdInstance);
                            debug(`Command ${name} registered`);
                        }
                    } else {
                        console.error(`Command ${name} already registered!`);
                    }
                }
            }
        }
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
}

module.exports = SipdCmd;
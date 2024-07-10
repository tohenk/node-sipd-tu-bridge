/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2024 Toha <tohenk@yahoo.com>
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
const { SiapDequeue } = require('../queue');
const debug = require('debug')('siap:cmd');

/**
 * Siap command handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SiapCmd {

    /**
     * Constructor.
     *
     * @param {string} name Command name
     * @param {object} options Options
     * @param {SiapDequeue} options.dequeue Dequeue
     * @param {object} options.parent Parent
     */
    constructor(name, options) {
        this.name = name;
        this.parent = options.parent;
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
     */
    static register(owner, prefix, dir) {
        dir = dir || __dirname;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            if (file.endsWith('.js')) {
                const cmd = file.substr(0, file.length - 3);
                if (cmd !== 'index') {
                    const name = cmd.replace('-', ':');
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
        });
    }

    /**
     * Get registered command.
     *
     * @param {string} name Name
     * @returns {SiapCmd}
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
                        socket.emit(cmd.name, result);
                    }
                }
            });
        }
    }

    /**
     * Get available commands.
     *
     * @returns {SiapCmd[]}
     */
    static get commands() {
        if (!this._commands) {
            this._commands = [];
        }
        return this._commands;
    }
}

module.exports = SiapCmd;
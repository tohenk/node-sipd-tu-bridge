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

const Queue = require('@ntlab/work/queue');
const SipdQueue = require('../app/queue');
const { SipdBridgeHandler } = require('.');

/**
 * SIPD bridge for common handling.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeCommon extends SipdBridgeHandler {

    /**
     * Perform noop.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    noop(queue) {
        const sess = this.bridge.getSessions()[0];
        if (sess) {
            return this.bridge.do([
                [w => sess.login()],
            ], (w, err) => {
                return [
                    [e => this.bridge.end(queue, this.bridge.autoClose)],
                ];
            });
        } else {
            return Promise.reject('No roles defined!');
        }
    }

    /**
     * Get captcha image.
     *
     * @returns {Promise<{[key: string]: string}>}
     */
    getCaptcha() {
        return new Promise((resolve, reject) => {
            const res = {};
            const q = new Queue([...this.bridge.getSessions()], session => {
                if (session.state().captcha) {
                    session.captchaImage()
                        .then(captcha => {
                            res[session.id] = captcha;
                            q.next();
                        })
                        .catch(err => reject(err));
                } else {
                    q.next();
                }
            });
            q.once('done', () => resolve(res));
        });
    }

    /**
     * Solve captcha using code.
     *
     * @param {string} code Captcha code
     * @returns {Promise<any>}
     */
    solveCaptcha(code, sess) {
        const session = this.bridge.getSessions().find(session => session.id === sess && session.state().captcha);
        if (session) {
            return session.solveCaptcha(code);
        }
        return Promise.resolve();
    }

    /**
     * Save captcha image.
     *
     * @param {string} dir Directory name
     * @returns {Promise<undefined>}
     */
    saveCaptcha(dir) {
        return new Promise((resolve, reject) => {
            const q = new Queue([...this.bridge.getSessions()], session => {
                if (session.state().captcha) {
                    session.works([
                        [w => session.captchaImage()],
                        [w => Promise.resolve(session.saveCaptcha(w.getRes(0), dir))],
                    ])
                    .then(() => q.next())
                    .catch(err => reject(err));
                } else {
                    q.next();
                }
            });
            q.once('done', () => resolve());
        });
    }

    /**
     * Save screenshot along with error/message and payload.
     *
     * @param {SipdQueue} queue Queue
     * @param {Error|string} message Message
     * @returns {Promise<any>}
     */
    saveScreenshot(queue, message) {
        const works = [];
        const sessions = Object.values(this.bridge.sessions)
            .filter(sess => sess.sipd.driver);
        for (const session of sessions) {
            works.push(
                [m => session.captureScreen(message, queue?.data, this.bridge.options.capturedirname)],
            );
        }
        return this.bridge.works(works);
    }
}

module.exports = SipdBridgeCommon;
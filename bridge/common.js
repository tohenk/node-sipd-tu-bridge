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

const SipdQueue = require('../app/queue');
const { SipdBridgeHandler } = require('.');
const { SipdRole } = require('../sipd/role');

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
     * @returns {Promise<string>|undefined}
     */
    getCaptcha() {
        for (const session of this.bridge.getSessions()) {
            if (session.state().captcha) {
                return session.captchaImage();
            }
        }
    }

    /**
     * Solve captcha using code.
     *
     * @param {string} code Captcha code
     * @returns {Promise<any>|undefined}
     */
    solveCaptcha(code) {
        for (const session of this.bridge.getSessions()) {
            if (session.state().captcha) {
                return session.solveCaptcha(code);
            }
        }
    }

    /**
     * Save captcha image.
     *
     * @param {string} dir Directory name
     * @returns {Promise<string>|undefined}
     */
    saveCaptcha(dir) {
        for (const session of this.bridge.getSessions()) {
            if (session.state().captcha) {
                return session.works([
                    [w => session.captchaImage()],
                    [w => Promise.resolve(session.saveCaptcha(w.getRes(0), dir))],
                ]);
            }
        }
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

    /**
     * Query for partner.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    queryRekanan(queue) {
        return this.bridge.processQueue({
            queue,
            works: [
                ['bp', w => this.bridge.doAs(SipdRole.BP)],
                ['bp-login', w => w.bp.login()],
                ['bp-rekanan', w => w.bp.listRekanan(queue)],
            ],
        });
    }
}

module.exports = SipdBridgeCommon;
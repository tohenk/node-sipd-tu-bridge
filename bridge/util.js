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

const SipdBridge = require('.');
const SipdSession = require('./session');
const Queue = require('@ntlab/work/queue');

class SipdUtilBridge extends SipdBridge {

    fetchCaptcha(queue) {
        const sess = this.getSessions()[0];
        if (sess) {
            const count = queue.data.count || 100;
            const oldOnState = this.onState;
            this.onState = s => {
                if (sess.state().captcha && !this._captcha) {
                    this._captcha = true;
                    const f = () => {
                        this._captcha = false;
                    }
                    this.getCaptchas(sess, count)
                        .then(() => f())
                        .catch(() => f());
                }
                if (typeof oldOnState === 'function') {
                    oldOnState(s);
                }
            }
            return this.do([
                [w => sess.login()],
            ], (w, err) => {
                return [
                    [e => this.end(queue, this.autoClose)],
                ];
            });
        } else {
            return Promise.reject('No roles defined!');
        }
    }

    /**
     * Get captcha images.
     *
     * @param {SipdSession} sess Session object
     * @param {number} count Number of captcha to fetch
     * @returns {Promise<any>}
     */
    getCaptchas(sess, count) {
        return new Promise((resolve, reject) => {
            const sequences = Array.from({length: count}, (v, i) => i + 1);
            const q = new Queue(sequences, async (seq) => {
                const res = await sess.captchaImage();
                if (res) {
                    this.getSessions()[0].saveCaptcha(res);
                }
                await sess.reloadCaptcha();
                q.next();
            });
            q.once('done', () => resolve());
        });
    }
}

module.exports = SipdUtilBridge;
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

const SiapBridge = require('.');
const SiapSession = require('./session');
const Queue = require('@ntlab/work/queue');

class SiapUtilBridge extends SiapBridge {

    fetchCaptcha(queue) {
        const sess = this.getSessions()[0];
        const count = queue.data.count || 100;
        const oldOnState = this.onState;
        this.onState = s => {
            if (sess.state().captcha && !this._captcha) {
                this._captcha = true;
                const f = () => {
                    this._captcha = false;
                    sess.cancelCaptcha()
                        .then(() => console.log('Captcha cancelled!'))
                        .catch(err => console.error(err));
                }
                this.getCaptchas(sess, count)
                    .then(() => f())
                    .catch(err => f());
            }
            if (typeof oldOnState === 'function') {
                oldOnState(s);
            }
        }
        return this.do([
            [w => sess.login()],
        ], (w, err) => {
            return [
                [e => this.end(this.autoClose)],
            ];
        });
    }

    /**
     * Get captcha images.
     *
     * @param {SiapSession} sess Session object
     * @param {number} count Number of captcha to fetch
     * @returns {Promise<any>}
     */
    getCaptchas(sess, count) {
        return new Promise((resolve, reject) => {
            const sequences = Array.from({length: count}, (v, i) => i + 1);
            const q = new Queue(sequences, async (seq) => {
                const res = await sess.captchaImage();
                if (res) {
                    this.saveCaptcha(res);
                }
                await sess.reloadCaptcha();
                q.next();
            });
            q.once('done', () => resolve());
        });
    }

    saveCaptcha(data) {
        const session = this.getSessions()[0];
        const [mimetype, payload] = data.split(';');
        const [encoding, content] = payload.split(',');
        if (content) {
            const buff = Buffer.from(content, encoding);
            const shasum = require('crypto')
                .createHash('md5')
                .update(buff)
                .digest('hex');
            const filename = session.genFilename('captcha', shasum + '.' + (mimetype.indexOf('png') > 0 ? 'png' : 'jpg'));
            session.saveFile(filename, buff);
        }
    }
}

module.exports = SiapUtilBridge;
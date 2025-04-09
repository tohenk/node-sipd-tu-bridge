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

const SipdCmd = require('.');

class SipdCmdCaptcha extends SipdCmd {

    consume(payload) {
        const { data } = payload;
        if (data.id && data.name) {
            let bridge;
            this.parent.bridges.forEach(b => {
                if (b.name === data.name) {
                    bridge = b;
                    return true;
                }
            });
            if (bridge && bridge.hasState('captcha')) {
                if (data.code) {
                    const captcha = bridge.solveCaptcha(data.code);
                    return {
                        ref: data.id,
                        name: data.name,
                        message: captcha ? 'Captcha code successfully applied' : 'Captcha is not required'
                    }
                } else {
                    return new Promise((resolve, reject) => {
                        const captcha = bridge.getCaptcha();
                        if (captcha) {
                            captcha
                                .then(res => resolve({ref: data.id, name: data.name, img: res}))
                                .catch(err => reject(Object.assign({ref: data.id}, this.createError(err))));
                        } else {
                            reject(Object.assign({ref: data.id}, this.createError('No captcha required!')));
                        }
                    });
                }
            }
        }
    }
}

module.exports = SipdCmdCaptcha;
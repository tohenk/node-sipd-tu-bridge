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

const SipdUtil = require('./util');

/**
 * Timer check callback.
 *
 * @callback SipdTimerFunction
 * @param {SipdTimer} t Timer object
 * @returns {void}
 */

/**
 * Execute callback for every second delta time.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdTimer
{
    constructor(options) {
        this.options = options || {};
        this.lastTime;
        this.startTime = new Date().getTime();
        this.delta = this.options.delta || 5;
    }

    /**
     * Check if callback should be called.
     *
     * @param {SipdTimerFunction} callback The callback
     * @returns {void}
     */
    check(callback) {
        this.deltaTime = Math.floor((new Date().getTime() - this.startTime) / 1000);
        if (
            this.deltaTime > 0 &&
            this.deltaTime % this.delta === 0 &&
            (this.lastTime === undefined || this.lastTime < this.deltaTime)
        ) {
            this.lastTime = this.deltaTime;
            if (typeof callback === 'function') {
                callback(this);
            }
        }
    }

    /**
     * Get formatted elapsed time.
     *
     * @returns {string}
     */
    get elapsedTime() {
        return SipdUtil.formatTime(this.deltaTime);
    }
}

module.exports = SipdTimer;
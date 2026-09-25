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

const WebRobot = require('@ntlab/webrobot');

/**
 * Base error.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdError extends WebRobot.WebRobotError {
}

/**
 * An error to indicate a restart operation.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRestartError extends SipdError {
}

/**
 * An error to indicate a retry operation.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdRetryError extends SipdError {
}

/**
 * An error to indicate a clean and retry operation.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCleanAndRetryError extends SipdRetryError {
}

/**
 * An error to indicate a stop operation when iterating data rows.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdStopError extends SipdError {
}

/**
 * An error to indicate an operation is aborted.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdAbortError extends SipdError {
}

/**
 * An error to indicate an operation is rejected.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdOperationError extends SipdError {
}

module.exports = {
    SipdError,
    SipdRestartError,
    SipdRetryError,
    SipdCleanAndRetryError,
    SipdStopError,
    SipdAbortError,
    SipdOperationError,
}
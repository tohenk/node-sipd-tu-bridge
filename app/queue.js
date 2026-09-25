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
const util = require('util');
const EventEmitter = require('events');
const SipdNotifier = require('./notifier');
const SipdLogger = require('./sipd/logger');
const SipdUtil = require('./sipd/util');
const debug = require('debug')('sipd:queue');
const { SipdError, SipdOperationError, SipdRetryError, SipdCleanAndRetryError } = require('./sipd/error');
const { glob } = require('glob');
const _ = require('@ntlab/ntlib/translator');

const dtag = 'queue';

/** @type {SipdDequeue} */
let dequeue;

/**
 * Create queue.
 *
 * @callback SipdCreateQueue
 * @param {object} data Queue data
 * @returns {[?SipdQueueResult, ?SipdQueue]}
 */

/**
 * Queue result object.
 *
 * @typedef {object} SipdQueueResult
 * @property {string} id Queue id
 * @property {string} type Queue type
 * @property {boolean} success Success state
 * @property {string} message Message
 * @property {?string} ref Queue reference id
 */

/**
 * A queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdDequeue extends EventEmitter {

    info = {}

    /**
     * Constructor.
     */
    constructor() {
        super();
        this.time = new Date();
        /** @type {SipdQueueArray} */
        this.queues = SipdQueueArray.create({
            callback: () => this.processQueue(),
            check: () => this.consumers,
        });
        /** @type {SipdQueueArray} */
        this.processing = SipdQueueArray.create({
            monitor: true,
            callback: () => this.processTimedout(),
        });
        /** @type {SipdQueueArray} */
        this.completes = SipdQueueArray.create();
        this.timeout = 5 * 6e4;
        this.retry = 3;
        /** @type {SipdCreateQueue} */
        this.createQueue;
        /** @type {string} */
        this.queueDir = path.join(process.cwd(), 'queue');
    }

    /**
     * Set queue consumer.
     *
     * @param {SipdConsumer|SipdConsumer[]} consumer Consumer
     * @returns {this}
     */
    setConsumer(consumer) {
        /** @type {SipdConsumer[]} */
        this.consumers = Array.isArray(consumer) ? consumer.sort((a, b) => a.priority - b.priority) : [consumer];
        for (consumer of this.consumers) {
            consumer
                .on('queue-done', queue => {
                    this.endQueue(queue);
                    this.emit('queue-done', queue);
                })
                .on('queue-error', queue => {
                    this.endQueue(queue);
                    this.emit('queue-error', queue);
                });
        }
        this.queues.process();
        return this;
    }

    /**
     * Process queue by handing queue to consumer.
     *
     * @returns {this}
     */
    processQueue() {
        try {
            if (this.consumers && this.queues.length) {
                for (const consumer of this.consumers) {
                    if (consumer.queue) {
                        continue;
                    }
                    const queues = this.queues.filter(a => consumer.isAccepted(a));
                    if (queues.length) {
                        const pickedConsumers = this.consumers.filter(a => !a.queue && a.isSimilar(consumer));
                        this.consumeQueue(queues[0], pickedConsumers);
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
        return this;
    }

    /**
     * Process processing queues for timeout.
     *
     * @returns {this}
     */
    processTimedout() {
        try {
            for (const queue of this.processing) {
                this.checkTimeout(queue);
            }
            this.checkOrphaned();
        } catch (err) {
            console.error(err);
        }
        return this;
    }

    /**
     * Check orphaned queues for timeout.
     */
    checkOrphaned() {
        this.consumers
            .map(consumer => consumer.queue)
            .filter(Boolean)
            .forEach(queue => this.checkTimeout(queue));
    }

    /**
     * Check queue for timeout.
     *
     * @param {SipdQueue} queue Queue
     */
    checkTimeout(queue) {
        if (queue && queue.status === SipdQueue.STATUS_PROCESSING) {
            // Queue has been processed but not started yet, just leave
            if (queue.started === null) {
                return;
            }
            const t = new Date().getTime();
            const d = t - (queue.started instanceof Date ? queue.started : queue.time).getTime();
            const timeout = queue.data && queue.data.timeout !== undefined ?
                queue.data.timeout : this.timeout;
            if (timeout > 0 && d > timeout) {
                queue.setStatus(SipdQueue.STATUS_TIMED_OUT);
                queue.setResult(_('Process timed out after %duration%', {duration: SipdUtil.formatTime(d / 1000)}));
                if (typeof queue.ontimeout === 'function') {
                    queue.ontimeout()
                        .then(() => this.endQueue(queue))
                        .catch(() => this.endQueue(queue));
                } else {
                    this.endQueue(queue);
                }
            }
        }
    }

    /**
     * Create new queue.
     *
     * @param {object} data Queue data
     * @returns {SipdQueue}
     */
    createNewQueue(data) {
        let queue;
        switch (data.type) {
            case SipdQueue.QUEUE_SPP:
                queue = SipdQueue.createSppQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_SPP_QUERY:
                queue = SipdQueue.createSppQueryQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_LPJ:
                queue = SipdQueue.createLpjQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_LPJ_QUERY:
                queue = SipdQueue.createLpjQueryQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_LPJ_LIST:
                queue = SipdQueue.createLpjListQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_REKANAN:
                queue = SipdQueue.createRekananQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_CAPTCHA:
                queue = SipdQueue.createCaptchaQueue(data.data);
                break;
            case SipdQueue.QUEUE_CLEAN:
                queue = SipdQueue.createCleanQueue(data.data);
                break;
        }
        if (queue) {
            if (data.mode) {
                queue.mode = data.mode;
            }
            if (queue.isFlagged('m') && typeof this.setMaps === 'function') {
                this.setMaps(queue);
            } else if (queue.info === undefined) {
                queue.info = null;
            }
            if (queue.isFlagged('r')) {
                queue.retry = true;
            }
            if (queue.isFlagged('-')) {
                queue.readonly = true;
            }
        }
        return queue;
    }

    /**
     * Consume queue by moving from queue to processing.
     *
     * @param {SipdQueue} queue Queue
     * @param {SipdConsumer[]} consumers Consumers
     * @returns {boolean}
     */
    consumeQueue(queue, consumers) {
        if (queue && consumers.length) {
            const idx = consumers.length > 1 ? Math.floor(Math.random() * consumers.length) : 0;
            const consumer = consumers[idx];
            queue.maxretry = this.retry;
            this.queues.move(queue, this.processing);
            debug('Queue', queue.toString(), 'is handled by', consumer.constructor.name);
            consumer.consume(queue);
            return true;
        }
        return false;
    }

    /**
     * End queue processing.
     *
     * @param {SipdQueue} queue Queue
     */
    endQueue(queue) {
        this.processing.move(queue, this.completes);
        this.setLastQueue(queue);
        if (queue.consumer) {
            delete queue.consumer.queue;
            delete queue.consumer;
        }
        this.queues.process();
    }

    /**
     * Set info data.
     *
     * @param {object} info Info
     * @returns {this}
     */
    setInfo(info) {
        this.info = {...info};
        return this;
    }

    /**
     * Add queue to process.
     *
     * @param {SipdQueue} queue Queue
     * @returns {SipdQueueResult}
     */
    add(queue) {
        let success = false, message;
        if (!queue.id) {
            queue.setId(SipdUtil.genId());
        }
        if (SipdQueue.hasPendingQueue(queue)) {
            message = _('Queue %queue% is already exist or being processed', {queue: queue.toString()});
        } else {
            success = true;
            message = _('Queue %queue% successfuly queued', {queue: queue.toString()});
            this.queues.add(queue);
            this.emit('queue', queue);
        }
        const res = {id: queue.id, type: queue.type, success, message};
        const ref = queue.getMappedData('info.id');
        if (ref) {
            res.ref = ref;
        }
        return res;
    }

    /**
     * Pick one unprocessed queue for consumer.
     *
     * @param {SipdConsumer} consumer Consumer
     * @returns {SipdQueue}
     */
    pick(consumer) {
        for (const queue of this.queues) {
            if (consumer.isAccepted(queue)) {
                return queue;
            }
        }
    }

    /**
     * Get next unprocessed queue.
     *
     * @returns {SipdQueue}
     */
    getNext() {
        return this.queues.length ? this.queues[0] : null;
    }

    /**
     * Get last processed queue.
     *
     * @returns {SipdQueue}
     */
    getLast() {
        return this.last;
    }

    /**
     * Set last processed queue, ignoring callback.
     *
     * @param {SipdQueue} queue Queue
     * @returns {this}
     */
    setLastQueue(queue) {
        if (queue.type !== SipdQueue.QUEUE_CALLBACK) {
            this.last = queue;
        }
        return this;
    }

    /**
     * Get processing status.
     *
     * @returns {object}
     */
    getStatus() {
        const status = Object.assign({}, this.buildInfo(this.info), {
            time: this.time.toString(),
            total: this.completes.length + this.processing.length + this.queues.length,
            queue: this.queues.length,
        });
        if (this.processing.length) {
            status.current = this.processing.map(queue => queue.toString()).join('<br/>');
        }
        const queue = this.getLast();
        if (queue) {
            status.last = queue.getLog();
        }
        return status;
    }

    /**
     * Get processing queue logs.
     *
     * @param {number} flags Flags
     * @returns {object[]}
     */
    getLogs(flags = 0) {
        return [...this.completes, ...this.processing, ...this.queues]
            .sort((a, b) => a.cmp(b))
            .filter(queue => {
                if ((flags & SipdQueue.LOG_AS_LOG) === SipdQueue.LOG_AS_LOG) {
                    return queue.isLoggable();
                }
                if ((flags & SipdQueue.LOG_AS_QUEUE) === SipdQueue.LOG_AS_QUEUE) {
                    return queue.isSaveable();
                }
                return true;
            })
            .map(queue => queue.getLog((flags & SipdQueue.LOG_RAW) === SipdQueue.LOG_RAW));
    }

    /**
     * Load saved queue logs.
     *
     * @param {Function} callback A callback when loading is done
     * @returns {Promise<undefined>}
     */
    async loadLogs(callback = null) {
        if (fs.existsSync(this.queueDir)) {
            const dt = SipdUtil.dateSerial(new Date());
            const files = (await glob(path.join(this.queueDir, '*.log'), {
                    stat: true,
                    withFileTypes: true,
                    windowsPathsNoEscape: true,
                }))
                .filter(a => SipdUtil.dateSerial(a.mtime) == dt)
                .sort((a, b) => a.mtime?.getTime() - b.mtime?.getTime());
            for (const file of files) {
                try {
                    console.log(_('Loading queue log from %filename%...', {filename: file.fullpath()}));
                    const logs = JSON.parse(fs.readFileSync(file.fullpath()));
                    if (Array.isArray(logs)) {
                        const ids = this.completes.map(a => a.id);
                        this.completes.push(...logs
                            .map(a => SipdQueue.fromLog(a))
                            .filter(a => !ids.includes(a.id) && SipdUtil.dateSerial(a.getTime()) == dt));
                    }
                } catch (err) {
                }
            }
            if (typeof callback === 'function') {
                callback();
            }
        }
    }

    /**
     * Save queue logs to file.
     *
     * @returns {void}
     */
    saveLogs() {
        const logs = this.getLogs(SipdQueue.LOG_RAW | SipdQueue.LOG_AS_LOG);
        if (logs.length) {
            if (!fs.existsSync(this.queueDir)) {
                fs.mkdirSync(this.queueDir, {recursive: true});
            }
            let filename, seq = 0;
            while (true) {
                filename = path.join(this.queueDir, `queue${++seq}.log`);
                if (!fs.existsSync(filename)) {
                    break;
                }
            }
            fs.writeFileSync(filename, JSON.stringify(logs, null, 2));
        }
    }

    /**
     * Load queue from file.
     *
     * @param {boolean} clean Clean queue after load
     * @returns {void}
     */
    loadQueue(clean = true) {
        const filename = path.join(this.queueDir, 'saved.queue');
        if (fs.existsSync(filename) && typeof this.createQueue === 'function') {
            const savedQueues = JSON.parse(fs.readFileSync(filename));
            if (savedQueues) {
                for (const queue of savedQueues) {
                    this.createQueue(queue);
                }
            }
            if (clean) {
                fs.unlinkSync(filename);
            }
        }
    }

    /**
     * Save unprocessed queue to file.
     *
     * @returns {void}
     */
    saveQueue() {
        const queues = this.queues.filter(queue => queue.isSaveable());
        if (queues.length) {
            const savedQueues = queues.map(queue => {
                const res = {};
                for (const prop of ['mode', 'type', 'id', 'data', 'callback']) {
                    if (queue[prop] !== undefined) {
                        res[prop] = queue[prop];
                    }
                }
                return res;
            });
            if (!fs.existsSync(this.queueDir)) {
                fs.mkdirSync(this.queueDir, {recursive: true});
            }
            const filename = path.join(this.queueDir, 'saved.queue');
            fs.writeFileSync(filename, JSON.stringify(savedQueues, null, 2));
        }
    }

    /**
     * Build status info.
     *
     * @param {object} info Info
     * @returns {object}
     */
    buildInfo(info) {
        const result = {};
        for (const k of Object.keys(info)) {
            let v = info[k];
            if (typeof v === 'function') {
                v = v();
            }
            result[k] = v;
        }
        return result;
    }
}

/**
 * A queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdConsumer extends EventEmitter {

    /**
     * Constructor.
     *
     * @param {number} priority The priority
     */
    constructor(priority) {
        super();
        /** @type {number} */
        this.priority = priority;
        /** @type {string|string[]|null} */
        this.accepts;
        /** @type {?SipdQueue} */
        this.queue;
        this.initialize();
    }

    /**
     * Do initialization.
     */
    initialize() {
    }

    /**
     * Is queue accepted?
     *
     * @param {SipdQueue} queue The queue
     * @returns {boolean}
     */
    canAccept(queue) {
        if (SipdQueue.hasPendingQueue({type: SipdQueue.QUEUE_CLEAN, info: null})) {
            return false;
        }
        return true;
    }

    /**
     * Is consumer can accept queue?
     *
     * @param {SipdQueue} queue The queue
     * @returns {boolean}
     */
    isAccepted(queue) {
        let res;
        // accepts all
        if (null === this.accepts) {
            res = true;
        }
        // accepts single queue type
        if (res === undefined && queue.type === this.accepts) {
            res = true;
        }
        // accepts multiple queue type
        if (res === undefined && Array.isArray(this.accepts) && this.accepts.includes(queue.type)) {
            res = true;
        }
        return res ? this.canAccept(queue) : false;
    }

    /**
     * Check if consumer can handle queue as handled by other consumer?
     *
     * @param {SipdConsumer} consumer Referenced consumer
     * @returns {boolean}
     */
    isSimilar(consumer) {
        if (this.constructor.name !== consumer.constructor.name) {
            return false;
        }
        if (this.priority !== consumer.priority) {
            return false;
        }
        if (this.bridge) {
            if (!consumer.bridge) {
                return false;
            }
            if (this.bridge.year !== consumer.bridge.year) {
                return false;
            }
        }
        return true;
    }

    /**
     * Consume queue.
     *
     * @param {SipdQueue} queue The queue
     */
    consume(queue) {
        const success = res => {
            if (!queue.finished()) {
                queue.done(res);
            }
            if (typeof queue.resolve === 'function') {
                queue.resolve(res);
            }
            this.emit('queue-done', queue);
        }
        const fail = err => {
            if (!queue.finished()) {
                queue.error(err);
            }
            if (typeof queue.reject === 'function') {
                queue.reject(err);
            }
            this.emit('queue-error', queue);
        }
        const retry = err => {
            const f = () => {
                if (queue.started !== undefined) {
                    delete queue.started;
                }
                queue.retryCount = (queue.retryCount !== undefined ? queue.retryCount : 0) + 1;
                if (err instanceof SipdRetryError && queue.retry && queue.retryCount <= queue.maxretry) {
                    SipdLogger.activity(dtag)(_('Retrying %queue% (%count%)...',
                        {queue: queue.toString(), count: queue.retryCount}));
                    if (typeof queue.onretry === 'function') {
                        queue.onretry()
                            .then(() => doit())
                            .catch(err => fail(err));
                    } else {
                        doit();
                    }
                } else {
                    fail(err);
                }
            }
            if (err instanceof SipdCleanAndRetryError && queue.bridge && queue.bridge.session) {
                const profileDir = queue.bridge.session.sipd.getProfileDir();
                if (fs.existsSync(profileDir)) {
                    this.cleanSubDir(profileDir, f);
                } else {
                    f();
                }
            } else {
                f();
            }
        }
        const doit = () => {
            try {
                this.emit('pre-queue', queue);
                queue.start();
                this.emit('queue-start', queue);
                this.doConsume(queue)
                    .then(res => success(res))
                    .catch(err => retry(err));
            }
            catch (err) {
                SipdLogger.activity(dtag)(_('Got an error while processing queue: %err%', {err}));
            }
        }
        queue.consumer = this;
        this.queue = queue;
        doit();
    }

    /**
     * Clean sub directory.
     *
     * @param {string} dir The directory
     * @param {Function} callback Callback to call when done
     */
    cleanSubDir(dir, callback) {
        glob(path.join(dir, '*'), {withFileTypes: true, windowsPathsNoEscape: true})
            .then(entries => {
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        fs.rmSync(entry.fullpath(), {recursive: true, force: true});
                    } else {
                        fs.rmSync(entry.fullpath(), {force: true});
                    }
                }
                if (entries.length) {
                    SipdLogger.activity(dtag)(_('Cleaned directory %dir%...', {dir}));
                } else {
                    SipdLogger.activity(dtag)(_('Skip cleaning empty directory %dir%...', {dir}));
                }
                if (typeof callback === 'function') {
                    callback(entries);
                }
            })
            .catch(err => {
                if (typeof callback === 'function') {
                    callback(err);
                } else {
                    console.error(err);
                }
            });
    }
}

/**
 * SIPD bridge queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeConsumer extends SipdConsumer {

    /**
     * Constructor.
     *
     * @param {import('./bridge').SipdBridge} bridge Bridge
     * @param {number} priority Priority
     */
    constructor(bridge, priority) {
        super(priority);
        /** @type {import('./bridge').SipdBridge} */
        this.bridge = bridge;
        this.on('pre-queue', queue => {
            SipdLogger.activity(dtag)(_('%bridge% is handling queue %queue%',
                {bridge: this.bridge.name, queue: queue.toString()}));
        });
    }

    /**
     * @inheritdoc
     */
    initialize() {
        this.accepts = [
            SipdQueue.QUEUE_SPP,
            SipdQueue.QUEUE_SPP_QUERY,
            SipdQueue.QUEUE_LPJ,
            SipdQueue.QUEUE_LPJ_QUERY,
            SipdQueue.QUEUE_LPJ_LIST,
            SipdQueue.QUEUE_REKANAN,
            SipdQueue.QUEUE_CAPTCHA,
        ];
    }

    /**
     * Is queue accepted?
     *
     * @param {SipdQueue} queue Queue
     * @returns {boolean}
     */
    canAccept(queue) {
        let reason, data;
        if (!super.canAccept(queue)) {
            reason = 'cleaning in progress';
        }
        if (!reason && !this.bridge.isOperational()) {
            reason = 'not operational';
        }
        if (!reason && this.bridge.queue && !this.bridge.queue.finished()) {
            reason = 'processing queue';
            data = this.bridge.queue;
        }
        if (!reason && this.bridge.accepts) {
            let accept = true;
            if (Array.isArray(this.bridge.accepts)) {
                if (!this.bridge.accepts.includes(queue.type)) {
                    accept = false;
                }
            } else {
                if (this.bridge.accepts != queue.type) {
                    accept = false;
                }
            }
            if (!accept) {
                reason = 'only accepts';
                data = this.bridge.accepts;
            }
        }
        if (!reason && this.bridge.year != queue?.data.year) {
            reason = 'only for';
            data = this.bridge.year;
        }
        if (reason) {
            if (data) {
                debug('%s is not ready for %s: %s %s', this.bridge.name, queue, reason, data);
            } else {
                debug('%s is not ready for %S: %s', this.bridge.name, queue, reason);
            }
            return false;
        } else {
            debug('%s is ready: can handle %s', this.bridge.name, queue);
            return true;
        }
    }

    /**
     * Consume queue for processing.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    doConsume(queue) {
        this.bridge.queue = queue;
        queue.bridge = this.bridge;
        queue.started = null;
        queue.onretry = () => this.bridge.end(queue);
        queue.ontimeout = () => this.bridge.end(queue);
        queue.onlock = () => {
            if (!queue.started) {
                queue.started = new Date();
                SipdLogger.activity(dtag)(_('Queue %queue% is marked as started',
                    {queue: queue.toString()}));
            }
        }
        switch (queue.type) {
            case SipdQueue.QUEUE_SPP:
                return this.bridge.createSpp(queue);
            case SipdQueue.QUEUE_SPP_QUERY:
                return this.bridge.querySpp(queue);
            case SipdQueue.QUEUE_LPJ:
                return this.bridge.createLpj(queue);
            case SipdQueue.QUEUE_LPJ_QUERY:
                return this.bridge.queryLpj(queue);
            case SipdQueue.QUEUE_LPJ_LIST:
                return this.bridge.listLpj(queue);
            case SipdQueue.QUEUE_REKANAN:
                return this.bridge.queryRekanan(queue);
            case SipdQueue.QUEUE_CAPTCHA:
                return this.bridge.fetchCaptcha(queue);
        }
    }
}

/**
 * Callback queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCallbackConsumer extends SipdConsumer {

    /**
     * @inheritdoc
     */
    initialize() {
        this.accepts = SipdQueue.QUEUE_CALLBACK;
    }

    /**
     * Consume queue for processing.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    doConsume(queue) {
        return SipdNotifier.notify(queue.callback, queue.data);
    }
}

/**
 * Cleaner queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCleanerConsumer extends SipdConsumer {

    /**
     * @inheritdoc
     */
    initialize() {
        this.accepts = SipdQueue.QUEUE_CLEAN;
    }

    /**
     * Consume queue for processing.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<boolean>}
     */
    doConsume(queue) {
        return new Promise((resolve, reject) => {
            if (queue.data && queue.data.dir && fs.existsSync(queue.data.dir)) {
                this.cleanSubDir(queue.data.dir, () => resolve(true));
            } else {
                resolve(false);
            }
        });
    }
}

/**
 * Blackhole queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBlackholeConsumer extends SipdConsumer {

    /**
     * @inheritdoc
     */
    initialize() {
        this.accepts = null;
    }

    /**
     * Consume queue for processing.
     *
     * @param {SipdQueue} queue Queue
     * @returns {Promise<any>}
     */
    doConsume(queue) {
        return Promise.reject(SipdOperationError.create('ignored'));
    }
}

/**
 * A queue.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueue {

    /**
     * Constructor.
     */
    constructor() {
        /** @type {?SipdConsumer} */
        this.consumer;
        /** @type {?string} */
        this.info;
        /** @type {?boolean} */
        this.readonly;
        /** @type {?boolean} */
        this.started;
        /** @type {?boolean} */
        this.retry;
        /** @type {?number} */
        this.maxretry;
        /** @type {string} */
        this.status = SipdQueue.STATUS_NEW;
    }

    /**
     * Set queue type.
     *
     * @param {string} type Queue type
     * @returns {this}
     */
    setType(type) {
        this.type = type;
        return this;
    }

    /**
     * Set queue id.
     *
     * @param {string} id Queue id
     * @returns {this}
     */
    setId(id) {
        this.id = id;
        return this;
    }

    /**
     * Set queue data.
     *
     * @param {object} data Queue data
     * @returns {this}
     */
    setData(data) {
        this.data = data;
        return this;
    }

    /**
     * Set queue callback.
     *
     * @param {string} callback Queue callback
     * @returns {this}
     */
    setCallback(callback) {
        this.callback = callback;
        return this;
    }

    /**
     * Set queue status.
     *
     * @param {string} status Queue status
     * @returns {this}
     */
    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
            SipdLogger.activity(dtag)(_('Queue %queue% %status%',
                {queue: this.toString(), status: _(this.getStatusText())}));
        }
        return this;
    }

    /**
     * Set queue result.
     *
     * @param {any} result Queue result
     * @returns {this}
     */
    setResult(result) {
        if (this.result !== result) {
            this.result = result;
            SipdLogger.activity(dtag)(_('Queue %queue% result: %result%',
                {queue: this.toString(), result: SipdUtil.toStr(result)}));
        }
        return this;
    }

    /**
     * Set queue time.
     *
     * @param {Date} time Queue time
     * @returns {this}
     */
    setTime(time) {
        if (time === null || time === undefined) {
            time = new Date();
        }
        this.time = time;
        return this;
    }

    /**
     * Get queue time.
     *
     * @returns {Date|undefined}
     */
    getTime() {
        let res = this.time;
        if (typeof res === 'string') {
            res = new Date(res);
        }
        return res;
    }

    /**
     * Get queue type.
     *
     * @returns {string}
     */
    getTypeText() {
        return this.type;
    }

    /**
     * Get queue status.
     *
     * @returns {string}
     */
    getStatusText() {
        return this.status;
    }

    /**
     * Get queue mapped data name.
     *
     * @param {string} name Map name
     * @returns {any}
     */
    getMap(name) {
        if (this.maps) {
            let parts;
            if (typeof name === 'string') {
                parts = name.split('.');
            } else if (Array.isArray(name)) {
                parts = [...name];
            }
            if (Array.isArray(parts)) {
                let o = this.maps;
                while (parts.length) {
                    let n = parts.shift();
                    if (o[n]) {
                        o = o[n];
                    } else {
                        o = null;
                        break;
                    }
                }
                return o;
            }
        }
    }

    /**
     * Get queue mapped data.
     *
     * @param {string} name Mapped data name
     * @returns {any}
     */
    getMappedData(name) {
        return this.getDataValue(this.getMap(name));
    }

    /**
     * Get queue data value.
     *
     * @param {string} key Data key
     * @returns {any}
     */
    getDataValue(key) {
        if (typeof key === 'string') {
            if (this.data[key] !== undefined) {
                return this.data[key];
            }
            // handle special value TYPE:value
            if (key.indexOf(':') > 0) {
                return this.getTranslatedValue(key);
            }
        }
    }

    /**
     * Get translated value.
     *
     * @param {string} value Data value
     * @returns {string}
     */
    getTranslatedValue(value) {
        const x = value.split(':');
        const vtype = x[0];
        const vvalue = x[1];
        const v = [];
        let values;
        switch (vtype) {
            case 'CONCAT':
                values = vvalue.split('|');
                const separator = values.shift();
                for (const val of values) {
                    v.push(this.getDataValue(val.trim()));
                }
                value = v.join(separator);
                break;
            case 'FORMAT':
                values = vvalue.split('|');
                value = values.shift();
                const fmtValues = values.map((val, i) => [new RegExp('%' + (i + 1) + '%', 'g'), this.getDataValue(val.trim())]);
                const nullOrUndefined = fmtValues.filter(a => a[1] === null || a[1] === undefined);
                if (fmtValues.length === nullOrUndefined.length) {
                    value = undefined;
                } else {
                    for (const [re, val] of fmtValues) {
                        value = value.replace(re, val);
                    }
                }
                break;
        }
        return value;
    }

    /**
     * Set data value.
     *
     * @param {string} name Data key
     * @param {any} value Data value
     * @returns {this}
     */
    setValue(name, value) {
        const key = this.getMap(name);
        if (key) {
            this.data[key] = value;
        }
        return this;
    }

    /**
     * Start and mark queue as processing.
     */
    start() {
        this.setTime();
        this.setStatus(SipdQueue.STATUS_PROCESSING);
    }

    /**
     * Finish queue and mark as done.
     *
     * @param {any} result Result
     */
    done(result) {
        this.setStatus(SipdQueue.STATUS_DONE);
        this.setResult(result);
    }

    /**
     * Finish queue and mark as error.
     *
     * @param {any} error Error
     */
    error(error) {
        this.setStatus(SipdQueue.STATUS_ERROR);
        this.setResult(error);
    }

    /**
     * Is queue finished?
     *
     * @returns {boolean}
     */
    finished() {
        return [
            SipdQueue.STATUS_DONE,
            SipdQueue.STATUS_ERROR,
            SipdQueue.STATUS_TIMED_OUT,
            SipdQueue.STATUS_SKIPPED,
        ].indexOf(this.status) >= 0;
    }

    /**
     * Get queue log.
     *
     * @param {boolean} raw Prefer raw value
     * @returns {object}
     */
    getLog(raw = false) {
        const res = {id: this.id, type: this.type};
        const info = this.getInfo();
        if (info) {
            res.name = info;
        }
        if (this.time) {
            res.time = this.time.toString();
        }
        res.status = this.status;
        if (this.result) {
            res.result = this.result instanceof Error ? this.result.toString() :
                (!raw && (Array.isArray(this.result) || typeof this.result === 'object') ? util.inspect(this.result) : this.result);
        }
        return res;
    }

    /**
     * Get queue information.
     *
     * @returns {string}
     */
    getInfo() {
        let info = this.info;
        if (!info && this.type === SipdQueue.QUEUE_CALLBACK) {
            [info] = SipdNotifier.getCallback(this.callback);
        }
        return info;
    }

    /**
     * Send result to callback or save to file.
     *
     * @param {any} result
     * @returns {this}
     */
    sendResult(result, dest) {
        if ((Array.isArray(result) && result.length) || (typeof result === 'object' && Object.keys(result).length)) {
            if (dest) {
                let queue;
                if (dest.match(/^(http(s)?:\/\/)/)) {
                    queue = SipdQueue.createCallbackQueue(result, dest);
                } else {
                    if (!fs.existsSync(dest)) {
                        fs.mkdirSync(dest, {recursive: true});
                    }
                    const stat = fs.statSync(dest);
                    if (stat && stat.isDirectory()) {
                        const filename = path.join(dest, `${this.filename}.json`);
                        fs.writeFileSync(filename, JSON.stringify(result));
                        console.log(_('Result saved to %filename%...', {filename}));
                    }
                }
                if (queue) {
                    SipdQueue.addQueue(queue);
                }
            } else if (this.callback || this.outdir) {
                this.sendResult(result, this.callback || this.outdir);
            }
        }
        return this;
    }

    /**
     * Compare queue for sorting.
     *
     * @param {SipdQueue} queue Queue to compare
     * @returns {number}
     */
    cmp(queue) {
        if (this.time === undefined) {
            if (queue.time === undefined) {
                return 0;
            } else {
                return 1;
            }
        } else {
            if (queue.time === undefined) {
                return -1;
            } else {
                return this.getTime() - queue.getTime();
            }
        }
    }

    /**
     * Check for flag is set or clear?
     *
     * @param {string} flag Flag
     * @returns {boolean}
     */
    isFlagged(flag) {
        return SipdQueue.hasFlag(this.type, flag);
    }

    /**
     * Is queue saveable?
     *
     * @returns {boolean}
     */
    isSaveable() {
        return this.isFlagged('e') && [SipdQueue.STATUS_NEW].includes(this.status) && !this.isSaved;
    }

    /**
     * Is queue loggable?
     *
     * @returns {boolean}
     */
    isLoggable() {
        return this.isFlagged('e') && ![SipdQueue.STATUS_NEW, SipdQueue.STATUS_PROCESSING].includes(this.status) && !this.isSaved;
    }

    /**
     * Get string representation of queue.
     *
     * @returns {string}
     */
    toString() {
        const info = this.getInfo();
        return `${this.getTypeText()}:${this.id}${info ? ' ' + info : ''}`;
    }

    /**
     * @returns {string}
     */
    get filename() {
        const Util = require('@ntlab/ntlib/util');
        return `${this.type}-${Util.formatDate(new Date(), 'yyyyMMddHHmmsszzz')}`;
    }

    /**
     * Create queue.
     *
     * @param {string} type Queue type
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static create(type, data, callback = null) {
        const queue = new this();
        queue.setType(type);
        queue.setData(data);
        if (callback) {
            queue.callback = callback;
        }
        return queue;
    }

    /**
     * Create queue with its data maps.
     *
     * @param {object} maps Data maps
     * @returns {SipdQueue}
     */
    static createWithMap(maps) {
        const queue = new this();
        queue.maps = maps;
        return queue;
    }

    /**
     * Create SPP queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createSppQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_SPP, data, callback);
    }

    /**
     * Create SPP QUERY queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createSppQueryQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_SPP_QUERY, data, callback);
    }

    /**
     * Create LPJ queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createLpjQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_LPJ, data, callback);
    }

    /**
     * Create LPJ QUERY queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createLpjQueryQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_LPJ_QUERY, data, callback);
    }

    /**
     * Create LPJ LIST queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createLpjListQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_LPJ_LIST, data, callback);
    }

    /**
     * Create REKANAN queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createRekananQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_REKANAN, data, callback);
    }

    /**
     * Create CALLBACK queue.
     *
     * @param {object} data Queue data
     * @param {string} callback Queue callback
     * @returns {SipdQueue}
     */
    static createCallbackQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_CALLBACK, data, callback);
    }

    /**
     * Create CAPTCHA queue.
     *
     * @param {object} data Queue data
     * @returns {SipdQueue}
     */
    static createCaptchaQueue(data) {
        return this.create(SipdQueue.QUEUE_CAPTCHA, data);
    }

    /**
     * Create CLEAN queue.
     *
     * @param {object} data Queue data
     * @returns {SipdQueue}
     */
    static createCleanQueue(data) {
        return this.create(SipdQueue.QUEUE_CLEAN, data);
    }

    /**
     * Create dequeuer.
     *
     * @returns {SipdDequeue}
     */
    static createDequeuer() {
        if (!dequeue) {
            dequeue = new SipdDequeue();
        }
        return dequeue;
    }

    /**
     * Add queue.
     *
     * @param {SipdQueue} queue Queue
     * @returns {object}
     */
    static addQueue(queue) {
        if (!dequeue) {
            throw SipdError.create('No dequeue instance has been created');
        }
        return dequeue.add(queue);
    }

    /**
     * Is same queue has pending processing?
     *
     * @param {SipdQueue|object} queue Queue
     * @returns 
     */
    static hasPendingQueue(queue) {
        if (dequeue && queue) {
            if ((queue instanceof this && queue.isFlagged('u')) || this.hasFlag(queue.type, 'u')) {
                const f = q => q.type === queue.type && q.info === queue.info;
                if ([...dequeue.queues.filter(f), ...dequeue.processing.filter(f)].length) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Is flag set on queue metadata?
     *
     * @param {string} type Queue type
     * @param {string} flag Queue flag
     * @returns {boolean}
     */
    static hasFlag(type, flag) {
        const metadata = this.QUEUE_METADATA;
        if (typeof metadata[type] === 'string') {
            return metadata[type].includes(flag) ? true : false;
        } else {
            if (this.notices === undefined) {
                this.notices = {};
            }
            if (this.notices[type] === undefined) {
                this.notices[type] = true;
                console.warn(_('Queue metadata %type% is not defined, add metadata in QUEUE_METADATA first', {type}));
            }
        }
        return false;
    }

    /**
     * Create queue from queue log data.
     *
     * @param {object} log Queue logged data
     * @returns {SipdQueue}
     */
    static fromLog(log) {
        const res = new this();
        res.isSaved = true;
        for (const k of ['id', 'type', ['name', 'info'], 'time', 'status', 'result']) {
            const value = log[Array.isArray(k) ? k[0] : k]; 
            if (value !== undefined) {
                res[Array.isArray(k) ? k[1] : k] = value;
            }
        }
        return res;
    }

    static get QUEUE_METADATA() {
        // e: can be exported
        // m: can have map
        // r: can be retried
        // u: unique, skip queue if exist
        // -: readonly
        return {
            [this.QUEUE_SPP]: 'emru',
            [this.QUEUE_SPP_QUERY]: 'emu-',
            [this.QUEUE_LPJ]: 'emru',
            [this.QUEUE_LPJ_QUERY]: 'emu-',
            [this.QUEUE_LPJ_LIST]: 'emu-',
            [this.QUEUE_REKANAN]: 'em-',
            [this.QUEUE_CALLBACK]: '',
            [this.QUEUE_CAPTCHA]: '',
            [this.QUEUE_CLEAN]: '',
        }
    }

    static get QUEUE_SPP() { return 'spp' }
    static get QUEUE_SPP_QUERY() { return 'spp-query' }
    static get QUEUE_LPJ() { return 'lpj' }
    static get QUEUE_LPJ_QUERY() { return 'lpj-query' }
    static get QUEUE_LPJ_LIST() { return 'lpj-list' }
    static get QUEUE_REKANAN() { return 'rekanan' }
    static get QUEUE_CALLBACK() { return 'callback' }
    static get QUEUE_CAPTCHA() { return 'captcha' }
    static get QUEUE_CLEAN() { return 'clean' }

    static get STATUS_NEW() { return 'new' }
    static get STATUS_PROCESSING() { return 'processing' }
    static get STATUS_DONE() { return 'done' }
    static get STATUS_ERROR() { return 'error' }
    static get STATUS_TIMED_OUT() { return 'timeout' }
    static get STATUS_SKIPPED() { return 'skipped' }

    static get LOG_RAW() { return 1 }
    static get LOG_AS_LOG() { return 2 }
    static get LOG_AS_QUEUE() { return 4 }

    static get DEQUEUE() { return SipdDequeue }
    static get CONSUMERS() { return {SipdBridgeConsumer, SipdCallbackConsumer, SipdCleanerConsumer, SipdBlackholeConsumer} }
}

/**
 * Store queue in array.
 *
 * @extends {Array<SipdQueue>}
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueueArray extends Array {

    /**
     * Add queue.
     *
     * @param {SipdQueue} queue Queue
     * @returns {SipdQueueArray}
     */
    add(queue) {
        this.push(queue);
        this.process();
        return this;
    }

    /**
     * Move queue between array.
     *
     * @param {SipdQueue} queue Queue
     * @param {SipdQueueArray} destination Destination array
     * @returns {boolean}
     */
    move(queue, destination) {
        const i = this.indexOf(queue);
        if (i >= 0) {
            this.splice(i, 1);
            destination.add(queue);
            return true;
        }
        return false;
    }

    /**
     * Process queue.
     *
     * @returns {void}
     */
    process() {
        if (!this.length || (typeof this.oncheck === 'function' && !this.oncheck())) {
            return;
        }
        if (typeof this.onqueue === 'function') {
            process.nextTick(() => this.onqueue());
        }
        if (this.monitor) {
            setTimeout(() => this.process(), 1000);
        }
    }

    /**
     * Create queue array.
     *
     * @param {object} options Options
     * @param {Function} options.callback Callback function
     * @param {Function} options.check Check function
     * @returns {SipdQueueArray}
     */
    static create(options = {}) {
        const res = new this();
        if (options.monitor !== undefined) {
            res.monitor = options.monitor;
        }
        if (typeof options.callback === 'function') {
            res.onqueue = options.callback;
        }
        if (typeof options.check === 'function') {
            res.oncheck = options.check;
        }
        return res;
    }
}

module.exports = SipdQueue;

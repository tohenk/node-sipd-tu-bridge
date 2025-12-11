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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');
const EventEmitter = require('events');
const SipdNotifier = require('./notifier');
const { SipdRetryError, SipdCleanAndRetryError } = require('../sipd');
const debug = require('debug')('sipd:queue');

/** @type {SipdDequeue} */
let dequeue;

/**
 * A queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdDequeue extends EventEmitter {

    info = {}

    constructor() {
        super();
        this.time = new Date();
        /** @type {SipdQueue[]} */
        this.queues = [];
        /** @type {SipdQueue[]} */
        this.processing = [];
        /** @type {SipdQueue[]} */
        this.completes = [];
        this.timeout = 10 * 60 * 1000;
        this.retry = 3;
    }

    setConsumer(consumer) {
        /** @type {SipdConsumer[]} */
        this.consumers = Array.isArray(consumer) ? consumer : [consumer];
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
        this.processQueue();
        return this;
    }

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
            case SipdQueue.QUEUE_REKANAN:
                queue = SipdQueue.createRekananQueue(data.data, data.callback);
                break;
            case SipdQueue.QUEUE_CAPTCHA:
                queue = SipdQueue.createCaptchaQueue(data.data);
                break;
            case SipdQueue.QUEUE_NOOP:
                queue = SipdQueue.createNoopQueue(data.data);
                break;
            case SipdQueue.QUEUE_CLEAN:
                queue = SipdQueue.createCleanQueue(data.data);
                break;
        }
        if (queue) {
            if (queue.isFlagged('m') && typeof this.setMaps === 'function') {
                this.setMaps(queue);
            } else {
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

    processQueue() {
        if (this.consumers) {
            if (this.queues.length) {
                for (const queue of this.queues) {
                    // query idle consumer
                    const consumers = this.consumers
                        .sort((a, b) => a.priority - b.priority)
                        .filter(consumer => !consumer.queue && consumer.isAccepted(queue));
                    if (consumers.length) {
                        const pickedConsumers = consumers
                            .filter(consumer => consumer.priority === consumers[0].priority);
                        if (pickedConsumers.length) {
                            const idx = Math.floor(Math.random() * (pickedConsumers.length - 1));
                            const consumer = pickedConsumers[idx];
                            // move queue to processing
                            this.queues.splice(this.queues.indexOf(queue), 1);
                            this.processing.push(queue);
                            // hand the queue to consumer
                            queue.maxretry = this.retry;
                            consumer.consume(queue);
                            // start over
                            break;
                        }
                    }
                }
            }
            if (this.processing.length) {
                this.processTimedout();
            }
        }
    }

    processTimedout() {
        for (const queue of this.processing) {
            const t = new Date().getTime();
            const d = t - queue.time.getTime();
            const timeout = queue.data && queue.data.timeout !== undefined ?
                queue.data.timeout : this.timeout;
            if (timeout > 0 && d > timeout) {
                queue.setStatus(SipdQueue.STATUS_TIMED_OUT);
                if (typeof queue.ontimeout === 'function') {
                    queue.ontimeout()
                        .then(() => this.endQueue(queue))
                        .catch(() => this.endQueue(queue))
                    ;
                } else {
                    this.endQueue(queue);
                }
            }
        }
    }

    endQueue(queue) {
        this.processing.splice(this.processing.indexOf(queue), 1);
        this.completes.push(queue);
        this.setLastQueue(queue);
        if (queue.consumer) {
            delete queue.consumer.queue;
            delete queue.consumer;
        }
        if (this.queues.length || this.processing.length) {
            process.nextTick(() => this.processQueue());
        }
    }

    setInfo(info) {
        this.info = {...info};
        return this;
    }

    add(queue) {
        if (!queue.id) {
            queue.setId(this.genId());
        }
        this.queues.push(queue);
        this.emit('queue', queue);
        process.nextTick(() => this.processQueue());
        return {status: 'queued', id: queue.id};
    }

    pick(consumer) {
        for (const queue of this.queues) {
            if (consumer.isAccepted(queue)) {
                return queue;
            }
        }
    }

    getNext() {
        return this.queues.length ? this.queues[0] : null;
    }

    getLast() {
        return this.last;
    }

    setLastQueue(queue) {
        if (queue.type !== SipdQueue.QUEUE_CALLBACK) {
            this.last = queue;
        }
        return this;
    }

    genId() {
        return crypto
            .createHash('sha1')
            .update((new Date().getTime() + Math.random()).toString())
            .digest('hex')
            .substring(0, 8);
    }

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

    getLogs(flags = 0) {
        return [...this.completes, ...this.processing, ...this.queues]
            .sort((a, b) => a.cmp(b))
            .filter(queue => {
                if ((flags & this.constructor.LOG_AS_LOG) === this.constructor.LOG_AS_LOG) {
                    return queue.isLoggable();
                }
                if ((flags & this.constructor.LOG_AS_QUEUE) === this.constructor.LOG_AS_QUEUE) {
                    return queue.isSaveable();
                }
                return true;
            })
            .map(queue => queue.getLog((flags & this.constructor.LOG_RAW) === this.constructor.LOG_RAW));
    }

    saveLogs() {
        const logs = this.getLogs(this.constructor.LOG_RAW | this.constructor.LOG_AS_LOG);
        if (logs.length) {
            const queueDir = path.join(process.cwd(), 'queue');
            if (!fs.existsSync(queueDir)) {
                fs.mkdirSync(queueDir, {recursive: true});
            }
            let filename, seq = 0;
            while (true) {
                filename = path.join(queueDir, `queue${++seq}.log`);
                if (!fs.existsSync(filename)) {
                    break;
                }
            }
            fs.writeFileSync(filename, JSON.stringify(logs, null, 2));
        }
    }

    loadQueue() {
        const filename = path.join(process.cwd(), 'queue', 'saved.queue');
        if (fs.existsSync(filename) && typeof this.createQueue === 'function') {
            const savedQueues = JSON.parse(fs.readFileSync(filename));
            if (savedQueues) {
                savedQueues.forEach(queue => this.createQueue(queue));
            }
            fs.unlinkSync(filename);
        }
    }

    saveQueue() {
        const queues = this.queues.filter(queue => queue.isSaveable());
        if (queues.length) {
            const savedQueues = queues.map(queue => {
                return {
                    type: queue.type,
                    id: queue.id,
                    data: queue.data,
                    callback: queue.callback,
                }
            });
            const queueDir = path.join(process.cwd(), 'queue');
            if (!fs.existsSync(queueDir)) {
                fs.mkdirSync(queueDir, {recursive: true});
            }
            const filename = path.join(queueDir, 'saved.queue');
            fs.writeFileSync(filename, JSON.stringify(savedQueues, null, 2));
        }
    }

    buildInfo(info) {
        const result = {};
        Object.keys(info).forEach(k => {
            let v = info[k];
            if (typeof v === 'function') {
                v = v();
            }
            result[k] = v;
        });
        return result;
    }

    static get LOG_RAW() { return 1 }
    static get LOG_AS_LOG() { return 2 }
    static get LOG_AS_QUEUE() { return 4 }
}

/**
 * A queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdConsumer extends EventEmitter
{
    /**
     * Constructor.
     *
     * @param {number} priority The priority
     */
    constructor(priority) {
        super();
        this.priority = priority;
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
     * Consume queue.
     *
     * @param {SipdQueue} queue The queue
     */
    consume(queue) {
        const success = res => {
            queue.done(res);
            if (typeof queue.resolve === 'function') {
                queue.resolve(res);
            }
            this.emit('queue-done', queue);
        }
        const fail = err => {
            queue.error(err);
            if (typeof queue.reject === 'function') {
                queue.reject(err);
            }
            this.emit('queue-error', queue);
        }
        const retry = err => {
            if (err instanceof SipdCleanAndRetryError && queue.bridge && queue.bridge.session) {
                const profileDir = queue.bridge.session.sipd.getProfileDir();
                if (fs.existsSync(profileDir)) {
                    console.log('Cleaning directory %s...', profileDir);
                    fs.rmSync(profileDir, {recursive: true, force: true});
                }
            }
            queue.retryCount = (queue.retryCount !== undefined ? queue.retryCount : 0) + 1;
            if (err instanceof SipdRetryError && queue.retry && queue.retryCount <= queue.maxretry) {
                console.log('Retrying %s (%d)...', queue.toString(), queue.retryCount);
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
                console.error('Got an error while processing queue: %s!', err);
            }
        }
        this.queue = queue;
        this.queue.consumer = this;
        doit();
    }
}

/**
 * SIPD bridge queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBridgeConsumer extends SipdConsumer
{
    constructor(bridge, priority) {
        super(priority);
        this.bridge = bridge;
        this.on('pre-queue', queue => {
            debug('%s is handling queue %s', this.bridge.name, queue);
        });
    }

    initialize() {
        this.accepts = [
            SipdQueue.QUEUE_SPP,
            SipdQueue.QUEUE_SPP_QUERY,
            SipdQueue.QUEUE_LPJ,
            SipdQueue.QUEUE_LPJ_QUERY,
            SipdQueue.QUEUE_REKANAN,
            SipdQueue.QUEUE_CAPTCHA,
            SipdQueue.QUEUE_NOOP,
        ];
    }

    canAccept(queue) {
        let reason, data;
        if (SipdQueue.hasPendingQueue({type: SipdQueue.QUEUE_CLEAN, info: null})) {
            reason = 'cleaning in progress';
        }
        if (!reason && !this.bridge.isOperational()) {
            reason = 'not operational';
        }
        if (!reason && this.bridge.queue && !this.bridge.queue.finished()) {
            reason = 'processing queue';
            data = this.bridge.queue;
        }
        if (!reason && this.bridge.accepts && (
            (Array.isArray(this.bridge.accepts) && !this.bridge.accepts.includes(queue.type)) ||
            this.bridge.accepts !== queue.type
        )) {
            reason = 'only accepts';
            data = this.bridge.accepts;
        }
        if (reason) {
            const ctime = new Date().getTime();
            const xtime = this._time || ctime;
            const dtime = ctime - xtime;
            if (dtime % 100 === 0) {
                this._time = ctime;
                if (data) {
                    debug('%s not ready: %s %s', this.bridge.name, reason, data);
                } else {
                    debug('%s not ready: %s', this.bridge.name, reason);
                }
            }
            return false;
        } else {
            debug('%s ready: can handle %s', this.bridge.name, queue);
            return true;
        }
    }

    doConsume(queue) {
        this.bridge.queue = queue;
        queue.bridge = this.bridge;
        queue.onretry = () => this.bridge.end(queue);
        queue.ontimeout = () => this.bridge.end(queue);
        switch (queue.type) {
            case SipdQueue.QUEUE_SPP:
                return this.bridge.createSpp(queue);
            case SipdQueue.QUEUE_SPP_QUERY:
                return this.bridge.querySpp(queue);
            case SipdQueue.QUEUE_LPJ:
                return this.bridge.createLpj(queue);
            case SipdQueue.QUEUE_LPJ_QUERY:
                return this.bridge.queryLpj(queue);
            case SipdQueue.QUEUE_REKANAN:
                return this.bridge.queryRekanan(queue);
            case SipdQueue.QUEUE_CAPTCHA:
                return this.bridge.fetchCaptcha(queue);
            case SipdQueue.QUEUE_NOOP:
                return this.bridge.noop(queue);
        }
    }
}

/**
 * Callback queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCallbackConsumer extends SipdConsumer
{
    initialize() {
        this.accepts = SipdQueue.QUEUE_CALLBACK;
    }

    doConsume(queue) {
        return SipdNotifier.notify(queue);
    }
}

/**
 * Cleaner queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdCleanerConsumer extends SipdConsumer
{
    initialize() {
        this.accepts = SipdQueue.QUEUE_CLEAN;
    }

    doConsume(queue) {
        return new Promise((resolve, reject) => {
            let res = false;
            if (queue.data && queue.data.dir && fs.existsSync(queue.data.dir)) {
                console.log('Cleaning', queue.data.dir);
                fs.rmSync(queue.data.dir, {recursive: true, force: true});
                res = true;
            }
            resolve(res);
        });
    }
}

/**
 * Blackhole queue consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdBlackholeConsumer extends SipdConsumer
{
    initialize() {
        this.accepts = null;
    }

    doConsume(queue) {
        return Promise.reject('ignored!');
    }
}

/**
 * A queue.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SipdQueue
{
    constructor() {
        this.status = SipdQueue.STATUS_NEW;
    }

    setType(type) {
        this.type = type;
    }

    setId(id) {
        this.id = id;
    }

    setData(data) {
        this.data = data;
    }

    setCallback(callback) {
        this.callback = callback;
    }

    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
            console.log('Queue %s %s', this.toString(), this.getStatusText());
        }
    }

    setResult(result) {
        if (this.result !== result) {
            this.result = result;
            console.log('Queue %s result: %s', this.toString(), this.result instanceof Error ? this.result.toString() : this.result);
        }
    }

    setTime(time) {
        if (time === null || time === undefined) {
            time = new Date();
        }
        this.time = time;
    }

    getTypeText() {
        return this.type;
    }

    getStatusText() {
        return this.status;
    }

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

    getMappedData(name) {
        return this.getDataValue(this.getMap(name));
    }

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

    getTranslatedValue(value)
    {
        const x = value.split(':');
        const vtype = x[0];
        const vvalue = x[1];
        const v = [];
        let values;
        switch (vtype) {
            case 'CONCAT':
                values = vvalue.split('|');
                let separator = values.shift();
                values.forEach(n => {
                    v.push(this.getDataValue(n.trim()));
                });
                value = v.join(separator);
                break;
            case 'FORMAT':
                values = vvalue.split('|');
                value = values.shift();
                values.forEach((n, i) => {
                    value = value.replace(new RegExp('%' + (i + 1) + '%', 'g'), this.getDataValue(n.trim()));
                });
                break;
        }
        return value;
    }

    setValue(name, value) {
        const key = this.getMap(name);
        if (key) {
            this.data[key] = value;
        }
        return this;
    }

    start() {
        this.setTime();
        this.setStatus(SipdQueue.STATUS_PROCESSING);
    }

    done(result) {
        this.setStatus(SipdQueue.STATUS_DONE);
        this.setResult(result);
    }

    error(error) {
        this.setStatus(SipdQueue.STATUS_ERROR);
        this.setResult(error);
    }

    finished() {
        return [
            SipdQueue.STATUS_DONE,
            SipdQueue.STATUS_ERROR,
            SipdQueue.STATUS_TIMED_OUT,
            SipdQueue.STATUS_SKIPPED,
        ].indexOf(this.status) >= 0;
    }

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

    getInfo() {
        let info = this.info;
        if (!info && this.type === SipdQueue.QUEUE_CALLBACK) {
            info = this.callback;
        }
        return info;
    }

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
                return this.time - queue.time;
            }
        }
    }

    isFlagged(flag) {
        const metadata = this.constructor.QUEUE_METADATA;
        if (typeof metadata[this.type] === 'string') {
            return metadata[this.type].includes(flag) ? true : false;
        }
        return false;
    }

    isSaveable() {
        return this.isFlagged('e') && [SipdQueue.STATUS_NEW].includes(this.status);
    }

    isLoggable() {
        return this.isFlagged('e') && ![SipdQueue.STATUS_NEW, SipdQueue.STATUS_PROCESSING].includes(this.status);
    }

    toString() {
        const info = this.getInfo();
        return `${this.getTypeText()}:${this.id}${info ? ' ' + info : ''}`;
    }

    static create(type, data, callback = null) {
        const queue = new this();
        queue.setType(type);
        queue.setData(data);
        if (callback) {
            queue.callback = callback;
        }
        return queue;
    }

    static createWithMap(maps) {
        const queue = new this();
        queue.maps = maps;
        return queue;
    }

    static createSppQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_SPP, data, callback);
    }

    static createSppQueryQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_SPP_QUERY, data, callback);
    }

    static createLpjQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_LPJ, data, callback);
    }

    static createLpjQueryQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_LPJ_QUERY, data, callback);
    }

    static createRekananQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_REKANAN, data, callback);
    }

    static createCallbackQueue(data, callback = null) {
        return this.create(SipdQueue.QUEUE_CALLBACK, data, callback);
    }

    static createCaptchaQueue(data) {
        return this.create(SipdQueue.QUEUE_CAPTCHA, data);
    }

    static createNoopQueue(data) {
        return this.create(SipdQueue.QUEUE_NOOP, data);
    }

    static createCleanQueue(data) {
        return this.create(SipdQueue.QUEUE_CLEAN, data);
    }

    static createDequeuer() {
        if (!dequeue) {
            dequeue = new SipdDequeue();
        }
        return dequeue;
    }

    static addQueue(queue) {
        if (!dequeue) {
            throw new Error('No dequeue instance has been created!');
        }
        return dequeue.add(queue);
    }

    static hasPendingQueue(queue) {
        if (dequeue) {
            if (dequeue.queues.filter(q => q.type === queue.type && q.info === queue.info).length) {
                return true;
            }
            if (dequeue.processing.filter(q => q.type === queue.type && q.info === queue.info).length) {
                return true;
            }
        }
        return false;
    }

    static get QUEUE_METADATA() {
        // e: can be exported
        // m: can have map
        // r: can be retried
        // -: readonly
        return {
            [this.QUEUE_SPP]: 'emr',
            [this.QUEUE_SPP_QUERY]: 'em-',
            [this.QUEUE_LPJ]: 'emr',
            [this.QUEUE_LPJ_QUERY]: 'em-',
            [this.QUEUE_REKANAN]: 'em-',
        }
    }

    static get QUEUE_SPP() { return 'spp' }
    static get QUEUE_SPP_QUERY() { return 'spp-query' }
    static get QUEUE_LPJ() { return 'lpj' }
    static get QUEUE_LPJ_QUERY() { return 'lpj-query' }
    static get QUEUE_REKANAN() { return 'rekanan' }
    static get QUEUE_CALLBACK() { return 'callback' }
    static get QUEUE_CAPTCHA() { return 'captcha' }
    static get QUEUE_NOOP() { return 'noop' }
    static get QUEUE_CLEAN() { return 'clean' }

    static get STATUS_NEW() { return 'new' }
    static get STATUS_PROCESSING() { return 'processing' }
    static get STATUS_DONE() { return 'done' }
    static get STATUS_ERROR() { return 'error' }
    static get STATUS_TIMED_OUT() { return 'timeout' }
    static get STATUS_SKIPPED() { return 'skipped' }

    static get CONSUMERS() { return {SipdBridgeConsumer, SipdCallbackConsumer, SipdCleanerConsumer, SipdBlackholeConsumer} }
}

module.exports = SipdQueue;

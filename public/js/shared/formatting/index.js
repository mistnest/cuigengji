/**
 * Page-oriented Renderer module.
 * Migrated from the former monolithic app/bootstrap.js using the reviewed ownership map.
 */
'use strict';
/* eslint-disable no-undef, no-unused-vars */
function debounce(fn, delay) {
    let t;
    return function (...args) {
        clearTimeout(t);
        const wait = typeof delay === 'function' ? delay() : delay;
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function formatRelativeTime(ts) {
    const now = new Date();
    const d = new Date(ts);
    const diff = now.getTime() - ts;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const dayBefore = yesterday - 86400000;
    const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 7200000) return '1小时前';
    if (dDay === today) {
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return '今天 ' + hh + ':' + mm;
    }
    if (dDay === yesterday) return '昨天';
    if (dDay === dayBefore) return '前天';
    if (d.getFullYear() === now.getFullYear()) {
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    }
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

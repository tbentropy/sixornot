/* ***** BEGIN LICENSE BLOCK *****
 * Version: BSD License
 * 
 * Copyright (c) 2008-2015 Timothy Baldock. All Rights Reserved.
 * 
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 * 
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 * 
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 * 
 * 3. The name of the author may not be used to endorse or promote products derived from this software without specific prior written permission from the author.
 * 
 * 4. Products derived from this software may not be called "SixOrNot" nor may "SixOrNot" appear in their names without specific prior written permission from the author.
 * 
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE. 
 * 
 * ***** END LICENSE BLOCK ***** */

/*jslint white: true, maxerr: 100, indent: 4 */

/*jslint es5: true */
Components.utils.import("resource://sixornot/includes/logger.jsm");
// Import dns module (adds global symbol: dns_handler)
Components.utils.import("resource://sixornot/includes/dns.jsm");
/*jslint es5: false */

// Provided by Firefox:
/*global Components */

// Provided by Sixornot
/*global parse_exception, prefs */

var EXPORTED_SYMBOLS = [
    "get_request_cache",
    "create_new_entry"
];


// Make methods in this object for updating its state
// Adding/removing/lookup of entries (hide internal implementation)

/* Prepare and return a new blank entry for the hosts listing */
var create_new_entry = function (host, address, address_family, inner) {
    return {
        host: host,
        address: address,
        address_family: address_family,
        remote: true,
        show_detail: true,
        count: 1,
        ipv6s: [],
        ipv4s: [],
        dns_status: "ready",
        dns_cancel: null,
        lookup_ips: function (callback) {
            var entry, on_returned_ips;
            // Don't do IP lookup for local file entries
            if (this.address_family === 1) {
                this.dns_status = "complete";
                return;
            }
            /* Create closure containing reference to element and trigger async lookup with callback */
            entry = this;
            on_returned_ips = function (ips) {
                entry.dns_cancel = null;
                if (ips[0] === "FAIL") {
                    entry.ipv6s = [];
                    entry.ipv4s = [];
                    entry.dns_status = "failure";
                } else {
                    entry.ipv6s = ips.filter(dns_handler.is_ip6);
                    entry.ipv4s = ips.filter(dns_handler.is_ip4);
                    entry.dns_status = "complete";
                }
                // Also trigger page change event here to refresh display of IP tooltip
                callback(entry);
            };
            if (entry.dns_cancel) {
                entry.dns_cancel.cancel();
            }
            entry.dns_cancel = dns_handler.resolve_remote_async(entry.host, on_returned_ips);
        }
    };
};

var create_cache_entry = function (mainhost, initial_entries) {
    return {
        main: mainhost,
        entries: initial_entries
    };
};

/*
 * Contains two lists:
 * cache - All requests which have been made for webpages which are still in history
 * waitinglist - Requests which have yet to have an innerWindow ID assigned
 */
var get_request_cache = function () {
    return {
        cache: {},
        createCacheEntry: function (mainhost, id) {
            // Move anything currently on waiting list into new cache entry
            this.cache[id] = create_cache_entry(mainhost, this.waitinglist.splice(0, Number.MAX_VALUE));
        },
        addOrUpdate: function (data, id, dns_complete_callback) {
            if (!this.cache.hasOwnProperty(id)) {
                this.createCacheEntry(id);
            }
            if (!this.cache[id].entries.some(function (item, index, items) {
                if (item.host === data.host) {
                    item.count += 1;
                    //send_event("sixornot-count-change-event", domWindow, item); // TODO

                    if (item.address !== data.address && data.address !== "") {
                        item.address = data.address;
                        item.address_family = data.addressFamily;
                        //send_event("sixornot-address-change-event", domWindow, item); // TODO
                    }
                    return true;
                }
            })) {
                log("cache: adding new entry, host: " + data.host + ", remoteAddress: " + data.address, 1);
                new_entry = create_new_entry(data.host, data.address, data.addressFamily, id);
                new_entry.show_detail = false;
                new_entry.lookup_ips(dns_complete_callback);
                this.cache[id].entries.push(new_entry);
                //send_event("sixornot-new-host-event", domWindow, new_entry); // TODO
            }
        },
        get: function (id) {
            // Retrieve cache entry for id
            if (this.cache.hasOwnProperty(id)) {
                return this.cache[id];
            }
            return null;
        },
        remove: function (id) {
            // Remove cache entry for id
        },

        waitinglist: [],
        addOrUpdateToWaitingList: function (data) {
            if (!this.waitinglist.some(function (item, index, items) {
                if (item.host === data.host) {
                    item.count += 1;
                    if (item.address !== data.address && data.address !== "") {
                        item.address = data.address;
                        item.address_family = data.addressFamily;
                    }
                    return true;
                }
            })) {
                log("http-initial-load: New page load, adding new entry, host: " + data.host + ", remoteAddress: " + data.address, 1);
                this.waitinglist.push(
                    create_new_entry(data.host, data.address, data.addressFamily, null));
            }
        },
        print_cache: function () {
            var out = "cache is:\n";
            for (var property in this.cache) {
                if (this.cache.hasOwnProperty(property)) {
                    out += "[" + property + ": [";
                    out += "mainHost: '" + this.cache[property].main + "', ";
                    out += "entries: [";
                    this.cache[property].entries.forEach(function (item, index, items) {
                        out += "['";
                        out += item.host;
                        out += "'] ";
                    });
                    out += "]]],\n";
                }
            }
            return out;
        },
        print_waitinglist: function () {
            var out = "waitinglist is:\n";
            this.waitinglist.forEach(function (item, index, items) {
                out += "[";
                out += item.host;
                out += "],";
            });
            return out;
        }
    };
};


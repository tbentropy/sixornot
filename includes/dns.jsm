/*
 * Copyright 2008-2015 Timothy Baldock. All Rights Reserved.
 */

// Provided by Firefox:
/*global Components, Services, ChromeWorker */

// Provided by Sixornot
/*global log, parse_exception */

// Module imports we need
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://sixornot/includes/logger.jsm");

var EXPORTED_SYMBOLS = [
    "dnsResolver",
    "ipUtils",
    "create_local_address_info"
];

var callbacks = {
    // Set up request map, which will map async requests to their callbacks
    // Every time a request is started its callback is added to the callback_ids
    // When a request is completed the callback_ids can be queried to find the correct
    // callback to call.

    // callback_ids is an array of 2-item arrays - [ID <int>, callback <func>]
    callback_ids: [],
    next_id: 0,

    // Index this.callback_ids and return required callback
    find_by_id: function (callback_id) {
        "use strict";
        log("callbacks.find_by_id - callback_id: " + callback_id, 3);
        // Returns -1 if ID not found
        return this.callback_ids.map(function (a) {
            return a[0];
        }).indexOf(callback_id);
    },

    remove: function (callback_id) {
        "use strict";
        var i;
        i = this.find_by_id(callback_id);
        if (i !== -1) {
            log("callbacks.remove - found and removed callback_id: " + callback_id, 3);
            // Return the callback function
            return this.callback_ids.splice(i, 1)[0][1];
        }
        // If ID not found, return false
        log("callbacks.remove - could not find callback_id: " + callback_id, 3);
        return false;
    },

    add: function (callback) {
        "use strict";
        // Use next available callback ID, return that ID
        this.next_id = this.next_id + 1;
        this.callback_ids.push([this.next_id, callback]);
        log("callbacks.add - added new callback with id: " + this.next_id, 3);
        return this.next_id;
    },

    make_cancel_obj: function (callback_id) {
        "use strict";
        log("dnsResolver:make_cancel_obj - callback_id: " + callback_id, 3);
        return {
            cancel : function () {
                log("cancel_obj - cancelling callback_id: " + callback_id, 3);
                // Remove ID from callback_ids if it exists there
                callbacks.remove(callback_id);
            }
        };
    }
};

var dnsService = Components.classes["@mozilla.org/network/dns-service;1"]
                           .getService(Components.interfaces.nsIDNSService);

var reqids: {
    shutdown: 0,        // Shut down DNS resolver, must be last request!
    remotelookup: 1,    // Perform dns.resolve_remote lookup
    locallookup: 2,     // Perform dns.resolve_local lookup
    checkremote: 3,     // Check whether ctypes resolver is in use for remote lookups
    checklocal: 4,      // Check whether ctypes resolver is in use for local lookups
    log: 254            // A logging message (sent from worker to main thread only)
};

// The DNS Handler which does most of the work of the extension
var dnsResolver = (function () {
    var resolveRemoteUsingCTypes = true;
    var resolveLocalWithCTypes = true;
    var worker = null;

    switch(Services.appinfo.OS.toLowerCase()) {
        case "darwin":
            log("dnsResolver - init darwin ctypes resolver", 1);
            worker = new ChromeWorker("resource://sixornot/includes/ctypes/darwin.js");
            break;

        case "linux":
            log("dnsResolver - init linux ctypes resolver", 1);
            worker = new ChromeWorker("resource://sixornot/includes/ctypes/linux.js");
            break;

        case "winnt":
            log("dnsResolver - init winnt ctypes resolver", 1);
            worker = new ChromeWorker("resource://sixornot/includes/ctypes/winnt.js");
            break;

        default:
            // Fallback to using Firefox DNS resolver
            log("dnsResolver - init firefox resolver", 1);
            resolveRemoteUsingCTypes = false;
            resolveLocalWithCTypes = false;
            return;
    }

    worker.onmessage = function (evt) {  
        var data, callback;
        data = JSON.parse(evt.data);

        if (data.reqid === reqids.log) { // Log message from dns_worker
            log(data.content[0], data.content[1]);
        } else if (data.reqid === reqids.checkremote) { // checkremote, set remote ctypes status
            resolveRemoteUsingCTypes = data.content;
        } else if (data.reqid === reqids.checklocal) { // checklocal, set local ctypes status
            resolveLocalWithCTypes = data.content;
        } else if (data.reqid === reqids.remotelookup ||
                   data.reqid === reqids.locallookup) { // remotelookup/locallookup, find correct callback and call it
            callback = callbacks.remove(data.callbackid);
            // Execute callback
            if (callback) {
                callback(data.content);
            }
        }
    };

    worker.onerror = function (err) {
        log(err.message + ", " + err.filename + ", " + err.lineno, 1);
    };

    var resolveLocalCTypes = function (callback) {
        var new_callback_id = callbacks.add(callback);

        worker.postMessage(JSON.stringify({"callbackid": new_callback_id, "reqid": reqids.locallookup, "content": null}));

        return callbacks.make_cancel_obj(new_callback_id);
    };

    var resolveRemoteCTypes = function (host, callback) {
        var new_callback_id = callbacks.add(callback);

        worker.postMessage(JSON.stringify({"callbackid": new_callback_id, "reqid": reqids.remotelookup, "content": host}));

        return callbacks.make_cancel_obj(new_callback_id);
    };

    var resolveRemoteFirefox = function (host, callback) {
        var my_callback = {
            onLookupComplete : function (nsrequest, dnsresponse, nsstatus) {
                var ip_addresses;
                // Request has been cancelled - ignore
                if (nsstatus === Components.results.NS_ERROR_ABORT) {
                    return;
                }
                // Request has failed for some reason
                if (nsstatus !== 0 || !dnsresponse || !dnsresponse.hasMore()) {
                    if (nsstatus === Components.results.NS_ERROR_UNKNOWN_HOST) {
                        log("dnsResolver:resolveRemoteFirefox - resolve host failed, unknown host", 1);
                        callback(["FAIL"]);
                    } else {
                        log("dnsResolver:resolveRemoteFirefox - resolve host failed, status: " + nsstatus, 1);
                        callback(["FAIL"]);
                    }
                    // Address was not found in DNS for some reason
                    return;  
                }
                // Otherwise address was found
                ip_addresses = [];
                while (dnsresponse.hasMore()) {
                    ip_addresses.push(dnsresponse.getNextAddrAsString());
                }
                // Call callback for this request with ip_addresses array as argument
                log("dnsResolver:resolveRemoteFirefox - resolved addresses: " + ip_addresses, 2);
                callback(ip_addresses);
            }
        };
        try {
            return dnsService.asyncResolve(host, 0x01, my_callback, null);
        } catch (e) {
            Components.utils.reportError("Sixornot EXCEPTION: " + parse_exception(e));
            callback(["FAIL"]);
            return null;
        }
    };

    return {
        /* Shuts down the native dns resolver (if running) */
        // TODO can this be an unload() call?
        shutdown: function () {
            log("dnsResolver:shutdown", 1);

            worker.postMessage(JSON.stringify({"reqid": reqids.shutdown, "content": null}));

            // Remove worker's event listeners as added in init(), this prevents messages
            // sent by the worker after shutdown from triggering anything
            worker.onmessage = null;
            worker.onerror = null;
        },

        getLocalHostname: function () {
            return dnsService.myHostName;
        },

        resolveLocal: function (callback) {
            if (resolveLocalWithCTypes) {
                return resolveLocalCTypes(callback);
            } else {
                return resolveRemoteFirefox(this.getLocalHostname(), callback);
            }
        },

        resolveRemote: function (host, callback) {
            if (resolveRemoteUsingCTypes) {
                return resolveRemoteCTypes(host, callback);
            } else {
                return resolveRemoteFirefox(host, callback);
            }
        }
    };
}());

var ipUtils = {
    /*
        IP Address utility functions
    */

    // Quick check for address family
    is_ip4 : function (ip_address) {
        "use strict";
        return ip_address && (ip_address.indexOf(".") !== -1 && ip_address.indexOf(":") === -1);
    },

    // Return the type of an IPv6 address
    /*
        -- For IPv4 addresses types are (from RFC 3330) --

        Address Block             Present Use                       Reference
        ---------------------------------------------------------------------
        0.0.0.0/8            "This" Network                 [RFC1700, page 4]
        10.0.0.0/8           Private-Use Networks                   [RFC1918]
        14.0.0.0/8           Public-Data Networks         [RFC1700, page 181]
        24.0.0.0/8           Cable Television Networks                    --
        39.0.0.0/8           Reserved but subject
                               to allocation                       [RFC1797]
        127.0.0.0/8          Loopback                       [RFC1700, page 5]
        128.0.0.0/16         Reserved but subject
                               to allocation                             --
        169.254.0.0/16       Link Local                                   --
        172.16.0.0/12        Private-Use Networks                   [RFC1918]
        191.255.0.0/16       Reserved but subject
                               to allocation                             --
        192.0.0.0/24         Reserved but subject
                               to allocation                             --
        192.0.2.0/24         Test-Net
        192.88.99.0/24       6to4 Relay Anycast                     [RFC3068]
        192.168.0.0/16       Private-Use Networks                   [RFC1918]
        198.18.0.0/15        Network Interconnect
                               Device Benchmark Testing            [RFC2544]
        223.255.255.0/24     Reserved but subject
                               to allocation                             --
        224.0.0.0/4          Multicast                              [RFC3171]
        240.0.0.0/4          Reserved for Future Use        [RFC1700, page 4]

        route           0.0.0.0/8                                   Starts with 0
        local           127.0.0.0/24                                Starts with 127
        rfc1918         10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16   Starts with 10, 172.16-31, 192.168
        linklocal       169.254.0.0/16                              Starts with 169.254
        reserved        240.0.0.0/4                                 Starts with 240-255
        documentation   192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24   Starts with 192.0.2, 198.51.100, 203.0.113
        6to4relay       192.88.99.0/24                              Starts with 192.88.99
        benchmark       198.18.0.0/15                               Starts with 198.18, 198.19
        multicast       224.0.0.0/4                                 Starts with 224-239
    */

    // Pad an IPv4 address to permit lexicographical sorting
    pad_ip4 : function (ip4_address) {
        "use strict";
        var pad = function (n) {
            return ("00" + n).substr(-3);
        };
        return ip4_address.split(".").map(pad).join(".");
    },
    // Remove leading zeros from IPv4 address
    unpad_ip4 : function (ip4_address) {
        "use strict";
        var unpad = function (n) {
            return parseInt(n, 10);
        };
        return ip4_address.split(".").map(unpad).join(".");
    },

    // Sort IPv4 addresses into logical ordering
    sort_ip4 : function (a, b) {
        "use strict";
        var typeof_a, typeof_b;
        typeof_a = this.typeof_ip4(a);
        typeof_b = this.typeof_ip4(b);
        // addresses of different types have a distinct precedence order
        // global, rfc1918, [other]
        if (typeof_a === typeof_b) {
            // TODO - move padding out of this function so it doesn't happen for every comparison in the sort
            a = this.pad_ip4(a);
            b = this.pad_ip4(b);
            if (a === b)
            {
                return 0;   // Identical
            }
            else if (a > b)
            {
                return 1;   // a > b
            }
            return -1;      // b > a
            // addresses of same type are compared based on their numeric values
            // e.g. 192.168.2.10 comes before 192.168.20.10
            // Compare expanded addresses, e.g. 010.011.002.003 with 010.012.001.019
            // Return -1 if a < b, 0 if a == b, 1 if a > b
        } else if (typeof_a === "global") {
            return -1;  // a comes before b
        } else if (typeof_b === "global") {
            return 1;   // b comes before a
        } else if (typeof_a === "rfc1918") {
            return -1;  // a comes before b
        } else if (typeof_b === "rfc1918") {
            return 1;   // b comes before a
        }
    },

    typeof_ip4 : function (ip_address) {
        "use strict";
        var split_address;
        // TODO - Function in_subnet (network, subnetmask, ip) to check if specified IP is in the specified subnet range
        if (!this.is_ip4(ip_address)) {
            return false;
        }
        split_address = ip_address.split(".").map(Number);
        if (split_address[0] === 0) {
            return "route";
        } else if (split_address[0] === 127) {
            return "localhost";
        } else if (split_address[0] === 10
             || (split_address[0] === 172 && split_address[1] >= 16 && split_address[1] <= 31)
             || (split_address[0] === 192 && split_address[1] === 168)) {
            return "rfc1918";
        } else if (split_address[0] === 169 && split_address[1] === 254) {
            return "linklocal";
        } else if (split_address[0] >= 240) {
            return "reserved";
        } else if ((split_address[0] === 192 && split_address[1] === 0  && split_address[2] === 2)
              || (split_address[0] === 198 && split_address[1] === 51 && split_address[2] === 100)
              || (split_address[0] === 203 && split_address[1] === 0  && split_address[2] === 113)) {
            return "documentation";
        } else if (split_address[0] === 192 && split_address[1] === 88 && split_address[2] === 99) {
            return "6to4relay";
        } else if (split_address[0] === 198 && [18,19].indexOf(split_address[1]) !== -1) {
            return "benchmark";
        } else if (split_address[0] >= 224 && split_address[0] <= 239) {
            return "multicast";
        } else {
            return "global";
        }
    },

    // Quick check for address family
    is_ip6 : function (ip_address) {
        "use strict";
        return ip_address && (ip_address.indexOf(":") !== -1);
    },

    // Expand IPv6 address into long version
    normalise_ip6 : function (ip6_address) {
        "use strict";
        var sides, left_parts, right_parts, middle, outarray, pad_left;
        // Split by instances of ::
        sides = ip6_address.split("::");
        // Split remaining sections by instances of :
        left_parts = sides[0].split(":");
        right_parts = (sides[1] && sides[1].split(":")) || [];

        middle = ["0", "0", "0", "0", "0", "0", "0", "0"].slice(0, 8 - left_parts.length - right_parts.length);
        outarray = Array.concat(left_parts, middle, right_parts);

        // Pad each component to 4 char length with zeros to left (and convert to lowercase)
        pad_left = function (str) {
            return ("0000" + str).slice(-4);
        };

        return outarray.map(pad_left).join(":").toLowerCase();
    },

    // Return the type of an IPv6 address
    /*
        -- For IPv6 addresses types are: --
        unspecified     ::/128                                          All zeros
        local           ::1/128         0000:0000:0000:0000:0000:0000:0000:0001
        linklocal       fe80::/10                                       Starts with fe8, fe9, fea, feb
        sitelocal       fec0::/10   (deprecated)                        Starts with fec, fed, fee, fef
        uniquelocal     fc00::/7    (similar to RFC1918 addresses)      Starts with: fc or fd
        pdmulticast     ff00::/8                                        Starts with ff
        v4transition    ::ffff:0:0/96 (IPv4-mapped)                     Starts with 0000:0000:0000:0000:0000:ffff
                        ::ffff:0:0:0/96 (Stateless IP/ICMP Translation) Starts with 0000:0000:0000:0000:ffff:0000
                        0064:ff9b::/96 ("Well-Known" prefix)            Starts with 0064:ff9b:0000:0000:0000:0000
        6to4            2002::/16                                       Starts with 2002
        teredo          2001::/32                                       Starts with 2001:0000
        benchmark       2001:2::/48                                     Starts with 2001:0002:0000
        documentation   2001:db8::/32                                   Starts with 2001:0db8
    */
    // Sort IPv6 addresses into logical ordering
    sort_ip6 : function (a, b) {
        "use strict";
        var typeof_a, typeof_b;
        typeof_a = this.typeof_ip6(a);
        typeof_b = this.typeof_ip6(b);
        // addresses of different types have a distinct precedence order
        // global, linklocal, [other]
        if (typeof_a === typeof_b) {
            // TODO - move normalise out of this function so it doesn't happen for every comparison in the sort
            a = this.normalise_ip6(a);
            b = this.normalise_ip6(b);
            if (a === b)
            {
                return 0;   // Identical
            }
            else if (a > b)
            {
                return 1;   // a > b
            }
            return -1;      // b > a
            // addresses of same type are compared based on their numeric values
            // e.g. fe80::2001 comes before fe80::2:2001
            // Comparison can be made lexicographically on normalised address
            // Return -1 if a < b, 0 if a == b, 1 if a > b
        }
        // They are not equal
        else if (typeof_a === "global")
        {
            return -1;  // a comes before b
        }
        else if (typeof_b === "global")
        {
            return 1;   // b comes before a
        }
        // Neither of them are global
        else if (typeof_a === "linklocal")
        {
            return -1;  // a comes before b
        }
        else if (typeof_b === "linklocal")
        {
            return 1;   // b comes before a
        }
    },

    typeof_ip6 : function (ip_address) {
        "use strict";
        var norm_address;
        log("ipUtils:typeof_ip6: " + ip_address, 3);
        // 1. Check IP version, return false if v4
        if (!this.is_ip6(ip_address)) {
            return false;
        }
        // 2. Normalise address, return false if normalisation fails
        norm_address = this.normalise_ip6(ip_address);
        // 3. Compare against type patterns
        if (norm_address === "0000:0000:0000:0000:0000:0000:0000:0000")
        {
            return "unspecified";
        }
        if (norm_address === "0000:0000:0000:0000:0000:0000:0000:0001"
         || norm_address === "fe80:0000:0000:0000:0000:0000:0000:0001") // linklocal address of loopback interface on Mac OSX
        {
            return "localhost";
        }
        if (["fe8", "fe9", "fea", "feb"].indexOf(norm_address.substr(0, 3)) !== -1)
        {
            return "linklocal";
        }
        if (["fec", "fed", "fee", "fef"].indexOf(norm_address.substr(0, 3)) !== -1)
        {
            return "sitelocal";
        }
        if (["fc", "fd"].indexOf(norm_address.substr(0, 2)) !== -1)
        {
            return "uniquelocal";
        }
        if (["ff"].indexOf(norm_address.substr(0, 2)) !== -1)
        {
            return "multicast";
        }
        if (["2002"].indexOf(norm_address.substr(0, 4)) !== -1)
        {
            return "6to4";
        }
        if (["2001:0000"].indexOf(norm_address.substr(0, 9)) !== -1)
        {
            return "teredo";
        }
        // If no other type then address is global
        return "global";
    }
};

var ipTests = {
    // Unit test suite for typeof_ip6 function, returns false if a test fails
    test_typeof_ip6 : function () {
        "use strict";
        var overall, tests, i, result;
        overall = true;
        tests = [
                        ["::", "unspecified"],
                        ["::1", "localhost"],
                        ["fe80::fa22:22ff:fee8:2222", "linklocal"],
                        ["fec0::ffff:fa22:22ff:fee8:2222", "sitelocal"],
                        ["fc00::1", "uniquelocal"],
                        ["ff00::1", "multicast"],
                        ["2002::1", "6to4"],
                        ["2001:0000::1", "teredo"],
                        ["2001:8b1:1fe4:1::2222", "global"],
                        ["192.168.2.1", false],
                        ["blah", false],
                        [":", false],
                        ["...", false]
                    ];
        for (i = 0; i < tests.length; i += 1) {
            result = ipUtils.typeof_ip6(tests[i][0]);
            if (result === tests[i][1]) {
                log("test_typeof_ip6, passed test value: " + tests[i][0] + ", result: " + result);
            } else {
                log("test_typeof_ip6, failed test value: " + tests[i][0] + ", expected result: " + i[1] + ", actual result: " + result);
                overall = false;
            }
        }
        return overall;
    },

    test_normalise_ip6 : function () {
        "use strict";
        var overall, tests, i, result;
        overall = true;
        tests = [
                        ["::",                                      "0000:0000:0000:0000:0000:0000:0000:0000"],
                        ["::1",                                     "0000:0000:0000:0000:0000:0000:0000:0001"],
                        ["fe80::fa22:22ff:fee8:2222",               "fe80:0000:0000:0000:fa22:22ff:fee8:2222"],
                        ["fc00::",                                  "fc00:0000:0000:0000:0000:0000:0000:0000"],
                        ["ff00:1234:5678:9abc:def0:d:ee:fff",       "ff00:1234:5678:9abc:def0:000d:00ee:0fff"],
                        ["2:0::1:2",                                "0002:0000:0000:0000:0000:0000:0001:0002"],
                        ["2001:8b1:1fe4:1::2222",                   "2001:08b1:1fe4:0001:0000:0000:0000:2222"],
                        ["2001:08b1:1fe4:0001:0000:0000:0000:2222", "2001:08b1:1fe4:0001:0000:0000:0000:2222"],
                        ["fe80::fa1e:dfff:fee8:db18%en1",           "fe80:0000:0000:0000:fa1e:dfff:fee8:db18"]
                    ];
        for (i = 0; i < tests.length; i += 1) {
            result = ipUtils.normalise_ip6(tests[i][0]);
            if (result === tests[i][1]) {
                log("test_normalise_ip6, passed test value: " + tests[i][0] + ", result: " + result, 1);
            } else {
                log("test_normalise_ip6, failed test value: " + tests[i][0] + ", expected result: " + tests[i][1] + ", actual result: " + result, 1);
                overall = false;
            }
        }
        return overall;
    },

    test_is_ip6 : function () {
        "use strict";
        var overall, tests, i, result;
        overall = true;
        tests = [
                        ["::",                                      true],
                        ["::1",                                     true],
                        ["fe80::fa22:22ff:fee8:2222",               true],
                        ["fc00::",                                  true],
                        ["ff00:1234:5678:9abc:def0:d:ee:fff",       true],
                        ["2:0::1:2",                                true],
                        ["2001:8b1:1fe4:1::2222",                   true],
                        ["2001:08b1:1fe4:0001:0000:0000:0000:2222", true],
                        ["192.168.2.1",                             false],
                        ["blah",                                    false],
                        [":::",                                     false],
                        [":",                                       false],
                        ["1::2::3",                                 false]
                    ];
        for (i = 0; i < tests.length; i += 1) {
            result = ipUtils.is_ip6(tests[i][0]);
            if (result === tests[i][1]) {
                log("test_is_ip6, passed test value: " + tests[i][0] + ", result: " + result);
            } else {
                log("test_is_ip6, failed test value: " + tests[i][0] + ", expected result: " + tests[i][1] + ", actual result: " + result);
                overall = false;
            }
        }
        return overall;
    }
};

var create_local_address_info = function () {
    var on_returned_ips, dns_cancel, new_local_host_info;
    dns_cancel = null;
    new_local_host_info = function () {
        return {
            ipv4s          : [],
            ipv6s          : [],
            host           : "",
            address        : "",
            remote         : false,
            address_family : 0,
            show_detail    : true,
            dns_status     : "pending"
        };
    };
    on_returned_ips = function (ips, callback, thisArg) {
        var local_host_info = new_local_host_info();
        log("panel:local_address_info:on_returned_ips - ips: " + ips, 1);
        dns_cancel = null;
        local_host_info.host = dnsResolver.getLocalHostname();
        if (ips[0] === "FAIL") {
            local_host_info.dns_status = "failure";
        } else {
            local_host_info.ipv6s = ips.filter(ipUtils.is_ip6);
            local_host_info.ipv4s = ips.filter(ipUtils.is_ip4);
            local_host_info.dns_status = "complete";
        }

        callback.call(thisArg, local_host_info);
    };
    return {
        get_local_host_info: function (callback, thisArg) {
            this.cancel();
            dns_cancel = dnsResolver.resolveLocal(function (ips) {
                on_returned_ips(ips, callback, thisArg);
            });
        },
        cancel: function () {
            if (dns_cancel) {
                dns_cancel.cancel();
            }
        }
    };
};


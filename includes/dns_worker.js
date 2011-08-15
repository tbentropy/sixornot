/* ***** BEGIN LICENSE BLOCK *****
 * Version: BSD License
 * 
 * Copyright (c) 2008-2011 Timothy Baldock. All Rights Reserved.
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

// Provided by Firefox:
/*global XPCOM, ctypes, postMessage, close, onmessage: true */

// Provided in included modules:
/*global */

// Provided in lazy getters
/*global */

// JSLint parameters
/*jslint white: false */


// Global variables defined by this script
var consoleService, log, parse_exception, dns, loglevel;

loglevel = 0;

// Utility functions

// Used by log to write messages to console
consoleService = XPCOM.getService("@mozilla.org/consoleservice;1");

log = function (message, level)
{
    // Three log levels, 0 = critical, 1 = normal, 2 = verbose
    // Default level is 1
    level = level || 1;
    // If preference unset, default to 1 (normal) level
    if (level <= loglevel)
    {
        consoleService.logStringMessage(message);
    }
};

// Returns a string version of an exception object with its stack trace
// TODO - Report exceptions back up to main thread for proper handling
parse_exception = function (e)
{
    if (!e)
    {
        return "";
    }
    else if (!e.stack)
    {
        return String(e);
    }
    else
    {
        return String(e) + " \n" + e.stack;
    }
};

// Data is an array
// [callback_id, request_id, data]
// callback_id is a number which will be passed back to the main thread
//      to indicate which callback function (if any) should be executed
//      when this request completes
// request_id references the type of request, see reqids table
// data is arbitrary information passed to the request_id function

// If you do var onmessage this doesn't function properly
onmessage = function (evt)
{
    log("Sixornot(dns_worker) - onmessage: " + evt.toSource(), 1);
    // Special case messages should be handled here
    if (evt.data && evt.data[1] && evt.data[1] === 255)
    {
        // 255 = init message
        // Set up DNS (load ctypes modules etc.)
        dns.init(evt.data[2]);
        // Post back message to indicate whether init was successful
        // Init also posts back messages to indicate specific success
        postMessage([-1, 255, true]);
    }
    else if (evt.data && evt.data[1] && evt.data[1] === 254)
    {
        // 254 = loglevel message
        // Set logging level to specified level
        loglevel = evt.data[2];
        log("Sixornot(dns_worker) - loglevel set to: " + evt.data[2], 1);
        // Return and indicate success
        postMessage([-1, 254, true]);
    }
    // All other codes should be passed through to dns for processing
    else if (evt.data && evt.data[1])
    {
        dns.dispatch_message(evt.data);
    }
};


// ChromeWorker specific dns functions
dns =
{
    AF_UNSPEC: null,
    AF_INET: null,
    AF_INET6: null,
    AF_LINK: null,
    library: null,
    sockaddr: null,
    addrinfo: null,
    getaddrinfo: null,
    ifaddrs: null,
    getifaddrs: null,
    remote_ctypes: false,
    local_ctypes: false,
    os: null,

    osx_library: "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
    win_library1: "iphlpapi.dll",
    win_library2: "Ws2_32.dll",
    linux_library: "libc.so.6",

    reqids: {
        shutdown: 0,        // Shut down DNS resolver, must be last request!
        remotelookup: 1,    // Perform dns.resolve_remote lookup
        locallookup: 2,     // Perform dns.resolve_local lookup
        checkremote: 3,     // Check whether ctypes resolver is in use for remote lookups
        checklocal: 4       // Check whether ctypes resolver is in use for local lookups
    },

    check_remote : function ()
    {
        log("Sixornot(dns_worker) - dns:check_remote, value: " + this.remote_ctypes);
        return this.remote_ctypes;
    },
    check_local : function ()
    {
        log("Sixornot(dns_worker) - dns:check_local, value: " + this.local_ctypes);
        return this.local_ctypes;
    },

    init : function (operatingsystem)
    {
        log("Sixornot(dns_worker) - dns:init");

        this.os = operatingsystem;

        // OS specific sections
        switch(this.os)
        {
            case "darwin":
                this.load_osx();
                log("Sixornot(dns_worker) - Ctypes resolver init completed for platform: OSX, this.remote_ctypes: " + this.remote_ctypes + ", this.local_ctypes: " + this.local_ctypes);
                break;

            case "linux":
                this.load_linux();
                log("Sixornot(dns_worker) - Ctypes resolver init completed for platform: LINUX, this.remote_ctypes: " + this.remote_ctypes + ", this.local_ctypes: " + this.local_ctypes);
                break;

            case "winnt":
                this.load_win();
                log("Sixornot(dns_worker) - Ctypes resolver init completed for platform: WIN, this.remote_ctypes: " + this.remote_ctypes + ", this.local_ctypes: " + this.local_ctypes);
                break;

            default:
                log("Sixornot(dns_worker) - Unknown platform - unable to init ctypes resolver, falling back to firefox");
                break;
        }

        // Post a message back to main thread to indicate availability of ctypes
        postMessage([-1, this.reqids.checkremote, this.remote_ctypes]);
        postMessage([-1, this.reqids.checklocal, this.local_ctypes]);

        log("Sixornot(dns_worker) - dns:init completed");
    },

    shutdown : function ()
    {
        log("Sixornot(dns_worker) - shutdown");
        if (this.remote_ctypes || this.local_ctypes)
        {
            // Shutdown ctypes library
            switch(this.os)
            {
                case "winnt":
                    this.library1.close();
                    this.library2.close();
                    break;
                case "osx":
                case "linux":
                    this.library.close();
                    break;

                default:
                    break;
            }
            // Close worker thread
            close();
        }
    },

    // Select correct function to execute based on ID code sent by main thread
    dispatch_message : function (message)
    {
        var dispatch, f, ret;
        log("Sixornot(dns_worker) - dns:dispatch_message: " + message.toSource(), 2);

        dispatch = [];
        dispatch[this.reqids.shutdown] = this.shutdown;
        dispatch[this.reqids.remotelookup] = this.resolve_remote;
        dispatch[this.reqids.locallookup] = this.resolve_local;
        dispatch[this.reqids.checkremote] = this.check_remote;
        dispatch[this.reqids.checklocal] = this.check_local;

        // Use request_id (data[1]) to select function
        f = dispatch[message[1]];
        if (f)
        {
            // Need to use function.call so that the value of "this" in the called function is set correctly
            ret = f.call(this, message[2]);
            // Return data to main thread
            postMessage([message[0], message[1], ret]);
        }
    },

    // Converts a sockaddr structure to a string representation of its address
    sockaddr_to_str : function (sockaddr)
    {
        var dispatch, f;
        log("Sixornot(dns_worker) - dns:sockaddr_to_str", 2);
        dispatch = [];
        dispatch[this.AF_INET] = this.af_inet_to_str;
        dispatch[this.AF_INET6] = this.af_inet6_to_str;
        dispatch[this.AF_LINK] = this.af_link_to_str;

        f = dispatch[sockaddr.sa_family];
        if (f)
        {
            // Need to use function.call so that the value of "this" in the called function is set correctly
            return f.call(this, sockaddr);
        }
        // Unknown address family, return false
        return false;
    },

    af_inet_to_str : function (sockaddr)
    {
        var sockaddr_in, ip4, ip4_address;
        log("Sixornot(dns_worker) - dns:af_inet_to_str", 2);
        // Cast to sockaddr_in
        sockaddr_in = ctypes.cast(sockaddr, this.sockaddr_in);
        // Read IP address value as 32bit number
        ip4 = sockaddr_in.sin_addr;
        // Convert to dotted decimal notation + return string
        /*jslint bitwise: false */
        ip4_address = [(ip4 << 24) >>> 24, (ip4 << 16) >>> 24, (ip4 << 8) >>> 24, ip4 >>> 24].join(".");
        /*jslint bitwise: true */
        return ip4_address;
    },
    af_inet6_to_str : function (sockaddr)
    {
        var sockaddr_in6, i, m, c, m_or_t;
        log("Sixornot(dns_worker) - dns:af_inet6_to_str", 2);
        // Cast to sockaddr_in6
        sockaddr_in6 = ctypes.cast(sockaddr, this.sockaddr_in6);
        // Convert to hex quad notation + return string
        // This code adapted from this example: http://phpjs.org/functions/inet_ntop:882
        i = 0;
        m = "";
        c = [];
        for (i = 0; i < sockaddr_in6.sin6_addr.length; i += 2)
        {
            /*jslint bitwise: false */
            c.push(((sockaddr_in6.sin6_addr[i] << 8) + sockaddr_in6.sin6_addr[i + 1]).toString(16));
            /*jslint bitwise: true */
        }
        // TODO - clean up this code to make it more readable
        // TODO - split this functionality off into separate function to compress IPv6 addresses
        m_or_t = function (t)
        {
            m = (t.length > m.length) ? t : m;
            return t;
        };
        return c.join(':').replace(/((^|:)0(?=:|$))+:?/g, m_or_t).replace(m || ' ', '::');
    },
    af_link_to_str : function (sockaddr)
    {
        log("Sixornot(dns_worker) - dns:af_link_to_str", 2);
        // Cast to ???
        // Read MAC address value
        // Convert to MAC format with '-' separators + return string
        return false;
    },

    resolve_local : function ()
    {
        var first_addr, first_addr_ptr, ret, i, addresses, new_addr;
        log("Sixornot(dns_worker) - dns:resolve_local", 2);

        switch(this.os)
        {
            case "winnt":
                adapbuf   = (ctypes.uint8_t.array(8192))();
                adapsize  = ctypes.unsigned_long(8192);
                adapflags = this.GAA_FLAG_SKIP_ANYCAST | this.GAA_FLAG_SKIP_MULTICAST  | this.GAA_FLAG_SKIP_DNS_SERVER | this.GAA_FLAG_SKIP_FRIENDLY_NAME;

                ret = this.GetAdaptersAddresses(this.AF_UNSPEC, adapflags, null, adapbuf, adapsize.address());

                if (ret != 0) {
                    log( LOG_VERBOSE, "Sixornot(dns_worker) - dns:resolve_local - GetAdaptersAddresses failed with exit code: " + ret );
                    return ["FAIL"];
                }

                adapter  = ctypes.cast(adapbuf, this.ipAdapterAddresses);
                addrbuf  = (ctypes.char.array(128))();
                addrsize = ctypes.uint32_t();
                addresses = [];

                // Loop through returned addresses and add them to array
                for (;;) {
                    if (adapter.IfType != this.IF_TYPE_SOFTWARE_LOOPBACK && adapter.IfType != this.IF_TYPE_TUNNEL && !adapter.FirstUnicastAddress.isNull()) {
                        address = adapter.FirstUnicastAddress.contents;

                        for (;;) {
                            switch (address.Address.lpSockaddr.contents.sa_family) {
                                case this.AF_INET:
                                case this.AF_INET6:
                                    addrsize.value = 128;
                                    this.WSAAddressToString(address.Address.lpSockaddr, address.Address.iSockaddrLength, null, addrbuf, addrsize.address());
                                    addresses.push(addrbuf.readString());
                                    break;
                            }

                            if (address.Next.isNull()) {
                                break;
                            }
                            address = address.Next.contents;
                        }
                    }

                    if (adapter.Next.isNull()) {
                        break;
                    }
                    adapter = adapter.Next.contents;
                }

                log("Sixornot(dns_worker) - dns:resolve_local - Found the following addresses: " + addresses, 2);
                return addresses.slice();
                break;

            case "darwin":
                ifaddr_ptr = this.ifaddrs.ptr();
                ret = this.getifaddrs(ifaddr_ptr.address());

                if (ret !== 0 || ifaddr_ptr.isNull())
                {
                    log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Got no results from getifaddrs", 1);
                    return ["FAIL"];
                }

                ifaddr    = ifaddr_ptr.contents;
                addrbuf   = (ctypes.char.array(128))();
                addresses = [];

                for (;;)
                {
                    switch(ifaddr.ifa_addr.contents.sa_family)
                    {
                        case this.AF_INET:
                            sockaddr = ctypes.cast(ifaddr.ifa_addr.contents, this.sockaddr_in);
                            this.inet_ntop(sockaddr.sin_family, sockaddr.sin_addr.address(), addrbuf, 128);
                            addresses.push(addrbuf.readString());
                            break;

                        case this.AF_INET6:
                            sockaddr = ctypes.cast(ifaddr.ifa_addr.contents, this.sockaddr_in6);
                            this.inet_ntop(sockaddr.sin6_family, sockaddr.sin6_addr.address(), addrbuf, 128);
                            addresses.push(addrbuf.readString());
                            break;
                    }

                    if (ifaddr.ifa_next.isNull())
                    {
                        break;
                    }
                    ifaddr = ifaddr.ifa_next.contents;
                }

                this.freeifaddrs(ifaddr_ptr);

                log("Sixornot(dns_worker) - dns:resolve_local - Found the following addresses: " + addresses, 2);
                return addresses.slice();
                break;

            case "linux":
                first_addr = this.ifaddrs();
                first_addr_ptr = first_addr.address();
                ret = this.getifaddrs(first_addr_ptr.address());

                if (first_addr_ptr.isNull())
                {
                    log("Sixornot(dns_worker) - dns:resolve_local - Got no results from getifaddrs", 1);
                    return ["FAIL"];
                }

                i = first_addr_ptr.contents;
                addresses = [];

                // Loop over the addresses retrieved by ctypes calls and transfer all of them into a javascript array
                for (;;)
                {
                    new_addr = this.sockaddr_to_str(i.ifa_addr.contents);

                    // Add to addresses array, check for blank return from get_ip_str, strip duplicates as we go
                    if (new_addr && addresses.indexOf(new_addr) === -1)
                    {
                        addresses.push(new_addr);
                    }
                    if (i.ifa_next.isNull())
                    {
                        break;
                    }
                    i = i.ifa_next.contents;
                }

                log("Sixornot(dns_worker) - dns:resolve_local - Found the following addresses: " + addresses, 2);
                return addresses.slice();
                break;

            default:
                log("Sixornot(dns_worker) - dns:resolve_local - Unknown operating system!");
                return ["FAIL"];
                break;
        }

    },

    // Proxy to ctypes getaddrinfo functionality
    resolve_remote : function (host)
    {
        var hints, first_addr, first_addr_ptr, ret, i, addresses, new_addr;
        var sockaddr, addrinfo, addrbuf;
        log("Sixornot(dns_worker) - dns:resolve_remote - resolving host: " + host, 2);

        switch(this.os)
        {
            case "darwin":
                addrinfo_ptr = this.addrinfo.ptr();
                ret = this.getaddrinfo(host, null, null, addrinfo_ptr.address());

                if (ret !== 0 || addrinfo_ptr.isNull())
                {
                    log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - Got no results from getaddrinfo", 1);
                    return ["FAIL"];
                }

                addrinfo  = addrinfo_ptr.contents;
                addrbuf   = (ctypes.char.array(128))();
                addresses = [];

                for (;;)
                {
                    switch(addrinfo.ai_addr.contents.sa_family)
                    {
                        case this.AF_INET:
                            sockaddr = ctypes.cast(addrinfo.ai_addr.contents, this.sockaddr_in);
                            this.inet_ntop(sockaddr.sin_family, sockaddr.sin_addr.address(), addrbuf, 128);
                            addresses.push(addrbuf.readString());
                            break;

                        case this.AF_INET6:
                            sockaddr = ctypes.cast(addrinfo.ai_addr.contents, this.sockaddr_in6);
                            this.inet_ntop(sockaddr.sin6_family, sockaddr.sin6_addr.address(), addrbuf, 128);
                            addresses.push(addrbuf.readString());
                            break;
                    }

                    if (addrinfo.ai_next.isNull())
                    {
                        break;
                    }
                    addrinfo = addrinfo.ai_next.contents;
                }

                this.freeaddrinfo(addrinfo_ptr);

                log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - Found the following addresses: " + addresses, 2);
                return addresses.slice();
                break;

            case "linux":
                first_addr = this.addrinfo();
                first_addr_ptr = first_addr.address();
                ret = this.getaddrinfo(host, null, null, first_addr_ptr.address());
                log("Sixornot(dns_worker) - " + ret, 0)
                // If we got no addresses of either kind then return failure
                if (first_addr_ptr.isNull())
                {
                    log("Sixornot(dns_worker) - dns:resolve_remote - Unable to resolve host, got no results from getaddrinfo", 1);
                    return ["FAIL"];
                }
                // Parse all addresses into array to return
                addresses = [];
                i = first_addr_ptr.contents;
                // Loop over the addresses retrieved by ctypes calls and transfer all of them into a javascript array
                for (;;)
                {
                    new_addr = this.sockaddr_to_str(i.ai_addr.contents);
                    log("Sixornot(dns_worker) - new_addr is: " + new_addr, 0);

                    // Add to addresses array, strip duplicates as we go
                    if (addresses.indexOf(new_addr) === -1)
                    {
                        addresses.push(new_addr);
                    }
                    if (i.ai_next.isNull())
                    {
                        break;
                    }
                    i = i.ai_next.contents;
                }
                log("Sixornot(dns_worker) - dns:resolve_remote - Found the following addresses: " + addresses, 0);
                return addresses.slice();
                break;
            case "winnt":
                // DO NOT USE AI_ADDRCONFIG ON WINDOWS.
                //
                // The following comment in <winsock2.h> is the best documentation I found
                // on AI_ADDRCONFIG for Windows:
                //   Flags used in "hints" argument to getaddrinfo()
                //       - AI_ADDRCONFIG is supported starting with Vista
                //       - default is AI_ADDRCONFIG ON whether the flag is set or not
                //         because the performance penalty in not having ADDRCONFIG in
                //         the multi-protocol stack environment is severe;
                //         this defaulting may be disabled by specifying the AI_ALL flag,
                //         in that case AI_ADDRCONFIG must be EXPLICITLY specified to
                //         enable ADDRCONFIG behavior
                //
                // Not only is AI_ADDRCONFIG unnecessary, but it can be harmful.  If the
                // computer is not connected to a network, AI_ADDRCONFIG causes getaddrinfo
                // to fail with WSANO_DATA (11004) for "localhost", probably because of the
                // following note on AI_ADDRCONFIG in the MSDN getaddrinfo page:
                //   The IPv4 or IPv6 loopback address is not considered a valid global
                //   address.
                // See http://crbug.com/5234.
                hints = this.addrinfo();
                hints.ai_flags = this.AI_ALL;
                hints.ai_family = this.AF_UNSPEC;
                hints.ai_socktype = 0;
                hints.ai_protocol = 0;
                hints.ai_addrlen = 0;


                addrinfo_ptr = this.addrinfo.ptr();
                ret = this.getaddrinfo(host, null, hints.address(), addrinfo_ptr.address());

                if (ret !== 0 || addrinfo_ptr.isNull())
                {
                    log("Sixornot(dns_worker) - dns:resolve_remote(WIN) - Got no results from getaddrinfo", 1);
                    return ["FAIL"];
                }

                addrinfo  = addrinfo_ptr.contents;
                addrbuf   = (ctypes.char.array(128))();
                addrsize  = ctypes.uint32_t();
                addresses = [];

                for (;;)
                {
                    switch(addrinfo.ai_addr.contents.sa_family)
                    {
                        case this.AF_INET:
                            addrsize.value = 128;
                            this.WSAAddressToString(addrinfo.ai_addr, 16, null, addrbuf, addrsize.address());
                            addresses.push(addrbuf.readString());
                            break;

                        case this.AF_INET6:
                            addrsize.value = 128;
                            this.WSAAddressToString(addrinfo.ai_addr, 28, null, addrbuf, addrsize.address());
                            addresses.push(addrbuf.readString());
                            break;
                    }

                    if (addrinfo.ai_next.isNull())
                    {
                        break;
                    }
                    addrinfo = addrinfo.ai_next.contents;
                }

                this.freeaddrinfo(addrinfo_ptr);

                log("Sixornot(dns_worker) - dns:resolve_remote - Found the following addresses: " + addresses, 0);
                return addresses.slice();
                break;

            default:
                log("Sixornot(dns_worker) - dns:resolve_remote - Unknown operating system!");
                return ["FAIL"];
                break;
        }
    },

    load_osx : function ()
    {
        // On Mac OSX do both local and remote lookups via ctypes
        this.remote_ctypes = true;
        this.local_ctypes  = true;
        try
        {
            this.library = ctypes.open(this.osx_library);
            log("Sixornot(dns_worker) - dns:load_osx - opened library: '" + this.osx_library + "'", 1);
        }
        catch (e)
        {
            log("Sixornot(dns_worker) - dns:load_osx - cannot open '" + this.osx_library + "' - ctypes lookup will be disabled", 0);
            log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
            this.local_ctypes  = false;
            this.remote_ctypes = false;
        }

        // Flags
        // Address family
        this.AF_UNSPEC      = 0;
        this.AF_INET        = 2;
        this.AF_LINK        = 18;  // MAC Addresses
        this.AF_INET6       = 30;
        // Socket type
        this.SOCK_STREAM    = 1;
        // Protocol
        this.IPPROTO_UNSPEC = 0;

        // Define ctypes structures
        this.sockaddr     = ctypes.StructType("sockaddr");
        this.sockaddr_in  = ctypes.StructType("sockaddr_in");
        this.sockaddr_in6 = ctypes.StructType("sockaddr_in6");
        this.addrinfo     = ctypes.StructType("addrinfo");
        this.ifaddrs      = ctypes.StructType("ifaddrs");

        // Set up the structs we need on OSX

        /* From /usr/include/sys/socket.h
        struct sockaddr {
            __uint8_t   sa_len;
            sa_family_t sa_family;
            char        sa_data[14];
        };
        typedef __uint8_t       sa_family_t; */
        this.sockaddr.define([
            { sa_len    : ctypes.uint8_t                 }, // Total length (1)
            { sa_family : ctypes.uint8_t                 }, // Address family (1)
            { sa_data   : ctypes.unsigned_char.array(28) }  // Address value (max possible size) (28)
            ]);                                             // (30) - must be larger than sockaddr_in and sockaddr_in6 for type casting to work

        /* From /usr/include/netinet/in.h
        typedef __uint16_t  in_port_t;
        typedef __uint32_t  in_addr_t;
        struct in_addr {
            in_addr_t s_addr;
        };
        struct sockaddr_in {
            __uint8_t   sin_len;
            sa_family_t sin_family;
            in_port_t   sin_port;
            struct      in_addr sin_addr;
            char        sin_zero[8];
        }; */
        this.sockaddr_in.define([
            { sin_len    : ctypes.uint8_t              },   // Total length (1)
            { sin_family : ctypes.uint8_t              },   // Address family (1)
            { sin_port   : ctypes.uint16_t             },   // Socket port (2)
            { sin_addr   : ctypes.uint32_t             },   // Address value (4)
            { sin_zero : ctypes.unsigned_char.array(8) }    // Padding (8)
            ]);                                             // (16)

        /* From /usr/include/netinet6/in6.h
        struct in6_addr {
            union {
                __uint8_t   __u6_addr8[16];
                __uint16_t  __u6_addr16[8];
                __uint32_t  __u6_addr32[4];
            } __u6_addr;
        };
        struct sockaddr_in6 {
            __uint8_t       sin6_len;
            sa_family_t     sin6_family;
            in_port_t       sin6_port;
            __uint32_t      sin6_flowinfo;
            struct in6_addr sin6_addr;
            __uint32_t      sin6_scope_id;
        }; */
        this.sockaddr_in6.define([
            { sin6_len      : ctypes.uint8_t           },   // Total length (1)
            { sin6_family   : ctypes.uint8_t           },   // Address family (1)
            { sin6_port     : ctypes.uint16_t          },   // Socket port (2)
            { sin6_flowinfo : ctypes.uint32_t          },   // IP6 flow information (4)
            { sin6_addr     : ctypes.uint8_t.array(16) },   // IP6 address value (or could be struct in6_addr) (16)
            { sin6_scope_id : ctypes.uint32_t          }    // Scope zone index (4)
            ]);                                             // (28)

        /*
        */
        this.addrinfo.define([
            { ai_flags     : ctypes.int        }, 
            { ai_family    : ctypes.int        }, 
            { ai_socktype  : ctypes.int        }, 
            { ai_protocol  : ctypes.int        }, 
            { ai_addrlen   : ctypes.int        }, 
            { ai_canonname : ctypes.char.ptr   }, 
            { ai_addr      : this.sockaddr.ptr }, 
            { ai_next      : this.addrinfo.ptr }
            ]);

        /* From /usr/include/ifaddrs.h
        struct ifaddrs {
            struct ifaddrs  *ifa_next;
            char            *ifa_name;
            unsigned int    ifa_flags;
            struct sockaddr *ifa_addr;
            struct sockaddr *ifa_netmask;
            struct sockaddr *ifa_dstaddr;
            void            *ifa_data;
        }; */
        this.ifaddrs.define([
            { ifa_next    : this.ifaddrs.ptr    },
            { ifa_name    : ctypes.char.ptr     },
            { ifa_flags   : ctypes.unsigned_int },
            { ifa_addr    : this.sockaddr.ptr   },
            { ifa_netmask : this.sockaddr.ptr   },
            { ifa_dstaddr : this.sockaddr.ptr   },
            { ifa_data    : ctypes.voidptr_t    }
            ]);

        // Set up the ctypes functions we need
        if (this.local_ctypes || this.remote_ctypes)
        {
            try
            {
                this.inet_ntop = this.library.declare("inet_ntop", ctypes.default_abi,
                    ctypes.char.ptr, ctypes.int, ctypes.voidptr_t, ctypes.char.ptr, ctypes.uint32_t);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_osx - Unable to setup 'inet_ntop' function, local_ctypes and remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
                this.remote_ctypes = false;
            }
        }
        if (this.remote_ctypes)
        {
            try
            {
                this.getaddrinfo = this.library.declare("getaddrinfo", ctypes.default_abi,
                    ctypes.int, ctypes.char.ptr, ctypes.char.ptr, this.addrinfo.ptr, this.addrinfo.ptr.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_osx - Unable to setup 'getaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }
        if (this.remote_ctypes)
        {
            try
            {
                this.freeaddrinfo = this.library.declare("freeaddrinfo", ctypes.default_abi,
                    ctypes.int, this.addrinfo.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_osx - Unable to setup 'freeaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }
        if (this.local_ctypes)
        {
            try
            {
                this.getifaddrs = this.library.declare("getifaddrs", ctypes.default_abi,
                    ctypes.int, this.ifaddrs.ptr.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_osx - Unable to setup 'getifaddrs' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
            }
        }
        if (this.local_ctypes)
        {
            try
            {
                this.freeifaddrs = this.library.declare("freeifaddrs", ctypes.default_abi,
                    ctypes.void_t, this.ifaddrs.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_osx - Unable to setup 'freeifaddrs' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
            }
        }

        // If initialisation failed then close library
        if (!this.local_ctypes && !this.remote_ctypes && this.library)
        {
            this.library.close();
            this.library = null;
        }

        // Everything worked, advise of success
        return true;
    },

    load_win : function ()
    {
        // On Windows do both local and remote lookups via ctypes
        this.remote_ctypes = true;
        this.local_ctypes  = true;
        try
        {
            // Library 1 needed only for local lookup
            this.library1 = ctypes.open(this.win_library1);
            log("Sixornot(dns_worker) - dns:load_win - Running on Windows XP+, opened library: '" + this.win_library1 + "'", 1);
        }
        catch (e)
        {
            log("Sixornot(dns_worker) - dns:load_win - cannot open '" + this.win_library1 + "' - ctypes local lookup will be disabled", 0);
            log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
            this.local_ctypes  = false;
        }
        try
        {
            // Library 2 needed for local and remote lookup
            this.library2 = ctypes.open(this.win_library2);
            log("Sixornot(dns_worker) - dns:load_win - Running on Windows XP+, opened library: '" + this.win_library2 + "'", 1);
        }
        catch (e)
        {
            log("Sixornot(dns_worker) - dns:load_win - cannot open '" + this.win_library2 + "' - ctypes local and remote lookup will be disabled", 0);
            log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
            this.remote_ctypes = false;
            this.local_ctypes  = false;
        }

        // Flags
        this.AI_PASSIVE                  = 0x01;
        this.AI_CANONNAME                = 0x02;
        this.AI_NUMERICHOST              = 0x04;
        this.AI_ALL                      = 0x0100;
        this.AI_ADDRCONFIG               = 0x0400;
        this.AI_NON_AUTHORITATIVE        = 0x04000;
        this.AI_SECURE                   = 0x08000;
        this.AI_RETURN_PREFERRED_NAMES   = 0x10000;
        // Address family
        this.AF_UNSPEC                   = 0;
        this.AF_INET                     = 2;
        this.AF_INET6                    = 23;
        // Socket type
        this.SOCK_STREAM                 = 1;
        this.SOCK_DGRAM                  = 2;
        this.SOCK_RAW                    = 3;
        this.SOCK_RDM                    = 4;
        this.SOCK_SEQPACKET              = 5;
        // Protocol
        this.IPPROTO_UNSPEC              = 0;
        this.IPPROTO_TCP                 = 6;
        this.IPPROTO_UDP                 = 17;
        this.IPPROTO_RM                  = 113;
        // Adaptor flags
        this.GAA_FLAG_SKIP_UNICAST       = 0x0001;
        this.GAA_FLAG_SKIP_ANYCAST       = 0x0002;
        this.GAA_FLAG_SKIP_MULTICAST     = 0x0004;
        this.GAA_FLAG_SKIP_DNS_SERVER    = 0x0008;
        this.GAA_FLAG_SKIP_FRIENDLY_NAME = 0x0020;

        this.IF_TYPE_SOFTWARE_LOOPBACK   =  24;
        this.IF_TYPE_TUNNEL              = 131;

        // Define ctypes structures
        this.sockaddr                = ctypes.StructType("sockaddr");
        this.sockaddr_in             = ctypes.StructType("sockaddr_in");
        this.sockaddr_in6            = ctypes.StructType("sockaddr_in6");
        this.addrinfo                = ctypes.StructType("addrinfo");
        this.ipAdapterAddresses      = ctypes.StructType("_IP_ADAPTER_ADDRESSES");
        this.ipAdapterUnicastAddress = ctypes.StructType("_IP_ADAPTER_UNICAST_ADDRESS");
        this.socketAddress           = ctypes.StructType("_SOCKET_ADDRESS");

        // Set up the structs we need on Windows XP+

        /* From: http://msdn.microsoft.com/en-us/library/ms740496(v=vs.85).aspx
        struct sockaddr {
            ushort  sa_family;
            char    sa_data[14];
        }; */
        this.sockaddr.define([
            { sa_family : ctypes.unsigned_short          },      // Address family (2)
            { sa_data   : ctypes.unsigned_char.array(28) }       // Address value (max possible size) (28)
            ]);                                                  // (30)

        /* From: http://msdn.microsoft.com/en-us/library/ms740496(v=vs.85).aspx
        struct sockaddr_in {
            short   sin_family;
            u_short sin_port;
            struct  in_addr sin_addr;
            char    sin_zero[8];
        }; */
        this.sockaddr_in.define([
            { sin_family : ctypes.short          },              // Address family (2)
            { sin_port   : ctypes.unsigned_short },              // Socket port (2)
            { sin_addr   : ctypes.unsigned_long  },              // Address value (or could be struct in_addr) (4)
            { sin_zero   : ctypes.char.array(8)  }               // Padding (8)
            ]);                                                  // (16)

        /* From: http://msdn.microsoft.com/en-us/library/ms738560(v=VS.85).aspx
        typedef struct in6_addr {
          union {
            u_char  Byte[16];
            u_short Word[8];
          } u;
        };
           From: http://msdn.microsoft.com/en-us/library/ms740496(v=vs.85).aspx
        struct sockaddr_in6 {
            short   sin6_family;
            u_short sin6_port;
            u_long  sin6_flowinfo;
            struct  in6_addr sin6_addr;
            u_long  sin6_scope_id;
        }; */
        this.sockaddr_in6.define([
            { sin6_family   : ctypes.short                   },  // Address family (2)
            { sin6_port     : ctypes.unsigned_short          },  // Socket port (2)
            { sin6_flowinfo : ctypes.unsigned_long           },  // IP6 flow information (4)
            { sin6_addr     : ctypes.unsigned_char.array(16) },  // IP6 address value (or could be struct in6_addr) (16)
            { sin6_scope_id : ctypes.unsigned_long           }   // Scope zone index (4)
            ]);                                                  // (28)

        /* From: http://msdn.microsoft.com/en-us/library/ms737530(v=vs.85).aspx
        struct addrinfo {
            int              ai_flags;
            int              ai_family;
            int              ai_socktype;
            int              ai_protocol;
            size_t           ai_addrlen;
            char             *ai_canonname;
            struct sockaddr  *ai_addr;
            struct addrinfo  *ai_next;
        }; */
        this.addrinfo.define([
            { ai_flags     : ctypes.int        },                // Flags for getaddrinfo options
            { ai_family    : ctypes.int        },                // Address family (UNSPEC, INET, INET6)
            { ai_socktype  : ctypes.int        },                // Socket type (STREAM, DGRAM, RAW, RDM, SEQPACKET)
            { ai_protocol  : ctypes.int        },                // Protocol type (TCP, UDP, RM)
            { ai_addrlen   : ctypes.int        },                // Length in bytes of buffer pointed to by ai_addr member
            { ai_canonname : ctypes.char.ptr   },                // Canonical name for host (if requested)
            { ai_addr      : this.sockaddr.ptr },                // Pointer to sockaddr structure
            { ai_next      : this.addrinfo.ptr }                 // Pointer to next addrinfo structure in linked list
            ]);

        // Used for local address lookup
        /* From: http://msdn.microsoft.com/en-us/library/aa366058(v=vs.85).aspx
        struct _IP_ADAPTER_ADDRESSES {
            union {
                ULONGLONG Alignment;
                struct {
                    ULONG   Length;
                    DWORD   IfIndex;
                };
            };
            struct _IP_ADAPTER_ADDRESSES    *Next;
            PCHAR                            AdapterName;
            PIP_ADAPTER_UNICAST_ADDRESS      FirstUnicastAddress;
            PIP_ADAPTER_ANYCAST_ADDRES       FirstAnycastAddress;   // Padding 1
            PIP_ADAPTER_MULTICAST_ADDRESS    FirstMulticastAddress; // Padding 1
            PIP_ADAPTER_DNS_SERVER_ADDRESS   FirstDnsServerAddress; // Padding 1
            PWCHAR                           DnsSuffix;             // Padding 1
            PWCHAR                           Description;           // Padding 1
            PWCHAR                           FriendlyName;          // Padding 1
            BYTE                             PhysicalAddress[8];    // Padding 2
            DWORD                            PhysicalAddressLength; // Padding 3
            DWORD                            Flags;                 // Padding 3
            DWORD                            Mtu;                   // Padding 3
            DWORD                            IfType;
            // Remaining members not implemented (not needed)
        }; */
        this.ipAdapterAddresses.define([
            { alignment           : ctypes.uint64_t                  },
            { Next                : this.ipAdapterAddresses.ptr      },
            { AdapterName         : ctypes.char.ptr                  },
            { FirstUnicastAddress : this.ipAdapterUnicastAddress.ptr },
            { padding_1           : ctypes.voidptr_t.array(6)        },
            { padding_2           : ctypes.uint8_t.array(8)          },
            { padding_3           : ctypes.uint32_t.array(3)         },
            { IfType              : ctypes.uint32_t                  }
            ]);

        /* From: http://msdn.microsoft.com/en-us/library/ms740507(v=vs.85).aspx
        struct _SOCKET_ADDRESS {
            LPSOCKADDR  lpSockaddr;
            INT         iSockaddrLength;
        }; */
        // Note: must be defined before _IP_ADAPTER_UNICAST_ADDRESS
        this.socketAddress.define([
            { lpSockaddr      : this.sockaddr.ptr },
            { iSockaddrLength : ctypes.int        }
            ]);

        /* From: http://msdn.microsoft.com/en-us/library/aa366066(v=vs.85).aspx
        struct _IP_ADAPTER_UNICAST_ADDRESS {
            union {
                struct {
                    ULONG   Length;
                    DWORD   Flags;
                };
            };
            struct _IP_ADAPTER_UNICAST_ADDRESS *Next;
            SOCKET_ADDRESS                      Address;
            // Remaining members not implemented (not needed)
        }; */
        this.ipAdapterUnicastAddress.define([
            { Length  : ctypes.uint32_t                  },
            { Flags   : ctypes.uint32_t                  },
            { Next    : this.ipAdapterUnicastAddress.ptr },
            { Address : this.socketAddress               }
        ]);

        // Set up the ctypes functions we need
        if (this.remote_ctypes)
        {
            try
            {
                this.getaddrinfo = this.library2.declare("getaddrinfo", ctypes.default_abi,
                    ctypes.int, ctypes.char.ptr, ctypes.char.ptr, this.addrinfo.ptr, this.addrinfo.ptr.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_win - Unable to setup 'getaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }

        if (this.remote_ctypes)
        {
            try
            {
                this.freeaddrinfo = this.library2.declare("freeaddrinfo", ctypes.default_abi,
                    ctypes.int, this.addrinfo.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_win - Unable to setup 'freeaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }

        if (this.local_ctypes)
        {
            // Try to initialise WSAAddressToString (Windows method for producing string representation of IP address)
            try
            {
                this.WSAAddressToString = this.library2.declare("WSAAddressToStringA",
                    ctypes.winapi_abi, ctypes.int, this.sockaddr.ptr, ctypes.uint32_t,
                    ctypes.voidptr_t, ctypes.char.ptr, ctypes.uint32_t.ptr );
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_win - Unable to setup 'WSAAddressToString' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.library1.close();
                this.local_ctypes = false;
            }
        }
        if (this.local_ctypes)
        {
            // Try to initialise GetAdaptorAddresses (Windows method for obtaining interface IP addresses)
            try
            {
                this.GetAdaptersAddresses = this.library1.declare("GetAdaptersAddresses",
                    ctypes.winapi_abi, ctypes.unsigned_long, ctypes.unsigned_long,
                    ctypes.unsigned_long, ctypes.voidptr_t, ctypes.uint8_t.ptr,
                    ctypes.unsigned_long.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_win - Unable to setup 'GetAdaptorAddresses' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
                this.local_ctypes = false;
            }
        }

        // If initialisation failed then close appropriate libraries
        if (!this.local_ctypes && this.library1)
        {
            this.library1.close();
            this.library1 = null;
        }
        if (!this.local_ctypes && !this.remote_ctypes && this.library2)
        {
            this.library2.close();
            this.library2 = null;
        }

        // Everything worked, advise of success
        return true;
    },

    load_linux : function ()
    {
        // On Linux do both local and remote lookups via ctypes
        this.remote_ctypes = true;
        this.local_ctypes  = true;
        try
        {
            this.library = ctypes.open(this.linux_library);
            log("Sixornot(dns_worker) - dns:load_linux - opened library: '" + this.linux_library + "'", 1);
        }
        catch (e)
        {
            log("Sixornot(dns_worker) - dns:load_linux - cannot open '" + this.linux_library + "' - ctypes lookup will be disabled", 0);
            log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
            this.local_ctypes  = false;
            this.remote_ctypes = false;
        }

        // Flags
        // Address family
        this.AF_UNSPEC      =  0;
        this.AF_INET        =  2;
        this.AF_INET6       = 10;
        // Protocol
        this.IPPROTO_UNSPEC = 0;

        // Define ctypes structures
        this.sockaddr     = ctypes.StructType("sockaddr");
        this.sockaddr_in  = ctypes.StructType("sockaddr_in");
        this.sockaddr_in6 = ctypes.StructType("sockaddr_in6");
        this.addrinfo     = ctypes.StructType("addrinfo");
        this.ifaddrs      = ctypes.StructType("ifaddrs");

        // Set up the structs we need on Linux

        /*
        */
        this.sockaddr.define([
            { sa_family : ctypes.uint16_t                }, // Address family (1)
            { sa_data   : ctypes.unsigned_char.array(28) }  // Address value (max possible size) (28)
            ]);                                             // (30) - must be larger than sockaddr_in and sockaddr_in6 for type casting to work

        /*
        */
        this.sockaddr_in.define([
            { sin_family : ctypes.uint16_t      },          // Address family (1)
            { sin_port   : ctypes.uint16_t      },          // Socket port (2)
            { sin_addr   : ctypes.uint32_t      },          // Address value (or could be struct in_addr) (4)
            { sin_zero   : ctypes.char.array(8) }           // Padding (8)
            ]);                                             // (16)

        /*
        */
        this.sockaddr_in6.define([
            { sin6_family   : ctypes.uint16_t          },   // Address family (1)
            { sin6_port     : ctypes.uint16_t          },   // Socket port (2)
            { sin6_flowinfo : ctypes.uint32_t          },   // IP6 flow information (4)
            { sin6_addr     : ctypes.uint8_t.array(16) },   // IP6 address value (or could be struct in6_addr) (16)
            { sin6_scope_id : ctypes.uint32_t          }    // Scope zone index (4)
            ]);                                             // (28)

        /*
        */
        this.addrinfo.define([
            { ai_flags     : ctypes.int        }, 
            { ai_family    : ctypes.int        }, 
            { ai_socktype  : ctypes.int        }, 
            { ai_protocol  : ctypes.int        }, 
            { ai_addrlen   : ctypes.int        }, 
            { ai_canonname : ctypes.char.ptr   }, 
            { ai_addr      : this.sockaddr.ptr }, 
            { ai_next      : this.addrinfo.ptr }
            ]);

        /*
        */
        this.ifaddrs.define([
             { ifa_next    : this.ifaddrs.ptr    },
             { ifa_name    : ctypes.char.ptr     },
             { ifa_flags   : ctypes.unsigned_int },
             { ifa_addr    : this.sockaddr.ptr   },
             { ifa_netmask : this.sockaddr.ptr   },
             { ifa_dstaddr : this.sockaddr.ptr   },
             { ifa_data    : ctypes.voidptr_t    }
             ]);

        // Set up the ctypes functions we need
        if (this.remote_ctypes)
        {
            try
            {
                this.getaddrinfo = this.library.declare("getaddrinfo", ctypes.default_abi, ctypes.int, ctypes.char.ptr, ctypes.char.ptr, this.addrinfo.ptr, this.addrinfo.ptr.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_linux - Unable to setup 'getaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }
        if (this.local_ctypes)
        {
            try
            {
                this.getifaddrs = this.library.declare("getifaddrs", ctypes.default_abi, ctypes.int, this.ifaddrs.ptr.ptr);
            }
            catch (e)
            {
                log("Sixornot(dns_worker) - dns:load_linux - Unable to setup 'getifaddrs' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
            }
        }

        // If initialisation failed then close library
        if (!this.local_ctypes && !this.remote_ctypes && this.library)
        {
            this.library.close();
            this.library = null;
        }

        // Everything worked, advise of success
        return true;
    }
};



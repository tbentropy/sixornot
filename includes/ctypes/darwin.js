/* ***** BEGIN LICENSE BLOCK *****
 * Version: BSD License
 * 
 * Copyright (c) 2014 Timothy Baldock. All Rights Reserved.
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

var resolver = {
    remote_ctypes: false,
    local_ctypes: false,

    library: "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",

    init : function () {
        "use strict";
        var e;
        // On Mac OSX do both local and remote lookups via ctypes
        this.remote_ctypes = true;
        this.local_ctypes  = true;
        try {
            this.library = ctypes.open(this.library);
        } catch (e) {
            log("Sixornot(dns_worker) - dns:init(OSX) - cannot open '"
                + this.library + "' - ctypes lookup will be disabled", 0);
            log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 1);
            this.local_ctypes  = false;
            this.remote_ctypes = false;
        }

        // Flags
        // Address family
        this.AF_UNSPEC      = 0;
        this.AF_INET        = 2;
        this.AF_INET6       = 30;
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

        /* From: http://developer.apple.com/library/mac/#documentation/Darwin/Reference/ManPages/man3/getaddrinfo.3.html
        struct addrinfo {
            int              ai_flags;
            int              ai_family;
            int              ai_socktype;
            int              ai_protocol;
            socklen_t        ai_addrlen;
            struct sockaddr *ai_addr; 
            char            *ai_canonname;
            struct addrinfo *ai_next; 
        };
        But this is incorrect!
        */
        this.addrinfo.define([
            { ai_flags     : ctypes.int        },  // input flags
            { ai_family    : ctypes.int        },  // protocol family for socket
            { ai_socktype  : ctypes.int        },  // socket type
            { ai_protocol  : ctypes.int        },  // protocol for socket
            { ai_addrlen   : ctypes.int        },  // length of socket-address
            { ai_canonname : ctypes.char.ptr   },  // canonical name for service location
            { ai_addr      : this.sockaddr.ptr },  // socket-address for socket
            { ai_next      : this.addrinfo.ptr }   // pointer to next in list
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
        if (this.local_ctypes || this.remote_ctypes) {
            try {
                this.inet_ntop = this.library.declare("inet_ntop", ctypes.default_abi,
                    ctypes.char.ptr, ctypes.int, ctypes.voidptr_t, ctypes.char.ptr, ctypes.uint32_t);
            } catch (e) {
                log("Sixornot(dns_worker) - dns:init(OSX) - Unable to setup 'inet_ntop' function, local_ctypes and remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
                this.remote_ctypes = false;
            }
        }

        if (this.remote_ctypes) {
            try {
                this.getaddrinfo = this.library.declare("getaddrinfo", ctypes.default_abi,
                    ctypes.int, ctypes.char.ptr, ctypes.char.ptr, this.addrinfo.ptr, this.addrinfo.ptr.ptr);
            } catch (e) {
                log("Sixornot(dns_worker) - dns:init(OSX) - Unable to setup 'getaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }
        if (this.remote_ctypes) {
            try {
                this.freeaddrinfo = this.library.declare("freeaddrinfo", ctypes.default_abi,
                    ctypes.int, this.addrinfo.ptr);
            } catch (e) {
                log("Sixornot(dns_worker) - dns:init(OSX) - Unable to setup 'freeaddrinfo' function, remote_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.remote_ctypes = false;
            }
        }

        if (this.local_ctypes) {
            try {
                this.getifaddrs = this.library.declare("getifaddrs", ctypes.default_abi,
                    ctypes.int, this.ifaddrs.ptr.ptr);
            } catch (e) {
                log("Sixornot(dns_worker) - dns:init(OSX) - Unable to setup 'getifaddrs' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
            }
        }
        if (this.local_ctypes) {
            try {
                this.freeifaddrs = this.library.declare("freeifaddrs", ctypes.default_abi,
                    ctypes.void_t, this.ifaddrs.ptr);
            } catch (e) {
                log("Sixornot(dns_worker) - dns:init(OSX) - Unable to setup 'freeifaddrs' function, local_ctypes disabled!", 0);
                log("Sixornot(dns_worker) EXCEPTION: " + parse_exception(e), 0);
                this.local_ctypes = false;
            }
        }

        // If initialisation failed then close library
        if (!this.local_ctypes && !this.remote_ctypes && this.library) {
            this.library.close();
            this.library = null;
        }

        log("Sixornot(dns_worker) - init(OSX) - Ctypes init completed - remote_ctypes: "
            + this.remote_ctypes + ", local_ctypes: " + this.local_ctypes, 1);
    },

    resolve_local : function () {
        "use strict";
        var ret, addresses, sa, address, ifaddr, ifaddr_ptr,
            adapbuf, adapsize, adapflags, adapter, addrbuf, addrsize,
            netmask, netmaskbuf;
        log("Sixornot(dns_worker) - dns:resolve_local(OSX)", 2);

        ifaddr_ptr = this.ifaddrs.ptr();
        ret = this.getifaddrs(ifaddr_ptr.address());

        if (ret > 0 || ifaddr_ptr.isNull()) {
            log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Got no results from getifaddrs", 1);
            return ["FAIL"];
        }

        // TODO
        // Change addresses to be an array of interface info dicts:
        // { interface: <interface name>,
        //   ipv4s: [ <array of IPv4 addresses> ],
        //   ipv6s: [ <array of IPv6 addresses> ],
        //   <other interface info>
        // }
        // IP Address:
        // { address: <ip address>,
        //   family: <4 or 6>, (or maybe others too)
        //   netmask: <network mask>,
        //   prefix: <prefix length>
        // }

        addrbuf   = (ctypes.char.array(128))();
        netmaskbuf   = (ctypes.char.array(128))();
        addresses = [];

        for (ifaddr = ifaddr_ptr; !ifaddr.isNull(); ifaddr = ifaddr.contents.ifa_next) {
            if (ifaddr.contents.ifa_addr.isNull()) {
                log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Null address on interface: '"
                    + ifaddr.contents.ifa_name.readString() + "' - skipping", 1);
                continue;
            } else {
            }

            if (ifaddr.contents.ifa_addr.contents.sa_family === this.AF_INET) {
                sa = ctypes.cast(ifaddr.contents.ifa_addr.contents, this.sockaddr_in);
                this.inet_ntop(sa.sin_family, sa.addressOfField("sin_addr"), addrbuf, 128);
                log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Found IPv4 address: '"
                    + addrbuf.readString() + "' on interface: '"
                    + ifaddr.contents.ifa_name.readString() + "'", 2);
                /*if (!ifaddr.contents.ifa_netmask.isNull()) {
                    netmask = ctypes.cast(ifaddr.contents.ifa_netmask.contents, this.sockaddr_in);
                    this.inet_ntop(netmask.sin_family, netmask.addressOfField("sin_addr"), netmaskbuf, 128);
                    log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Address for interface: '" + ifaddr.contents.ifa_name.readString() + "', address: '" + addrbuf.readString() + "', netmask: '" + netmaskbuf.readString() + "', prefix: '" + get_ipv4_prefix(netmask.sin_addr) + "'", 1);
                } else {
                    log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Address for interface: '" + ifaddr.contents.ifa_name.readString() + "', address: '" + addrbuf.readString() + "', netmask: '" + "null" + "', prefix: '" + "N/A"  + "'", 1);
                }*/
                if (addresses.indexOf(addrbuf.readString()) === -1)
                {
                    addresses.push(addrbuf.readString());
                }
            }

            if (ifaddr.contents.ifa_addr.contents.sa_family === this.AF_INET6) {
                sa = ctypes.cast(ifaddr.contents.ifa_addr.contents, this.sockaddr_in6);
                this.inet_ntop(sa.sin6_family, sa.addressOfField("sin6_addr"), addrbuf, 128);
                log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Found IPv6 address: '"
                    + addrbuf.readString() + "' on interface: '"
                    + ifaddr.contents.ifa_name.readString() + "'", 2);
                /*if (!ifaddr.contents.ifa_netmask.isNull()) {
                    netmask = ctypes.cast(ifaddr.contents.ifa_netmask.contents, this.sockaddr_in6);
                    this.inet_ntop(netmask.sin6_family, netmask.addressOfField("sin6_addr"), netmaskbuf, 128);
                    log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Address for interface: '" + ifaddr.contents.ifa_name.readString() + "', address: '" + addrbuf.readString() + "', netmask: '" + netmaskbuf.readString() + "', prefix: '" + get_ipv6_prefix(netmask.sin6_addr) + "'", 1);
                } else {
                    log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Address for interface: '" + ifaddr.contents.ifa_name.readString() + "', address: '" + addrbuf.readString() + "', netmask: '" + "null" + "', prefix: '" + "N/A"  + "'", 1);
                }*/
                if (addresses.indexOf(addrbuf.readString()) === -1)
                {
                    addresses.push(addrbuf.readString());
                }
            }
        }

        this.freeifaddrs(ifaddr_ptr);

        log("Sixornot(dns_worker) - dns:resolve_local(OSX) - Found addresses: " + addresses, 2);
        return addresses.slice();
    },

    resolve_remote : function (host) {
        "use strict";
        var hints, ret, addresses, addrinfo, addrbuf, addrinfo_ptr, sa, addrsize;
        log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - resolve host: '" + host + "'", 2);

        if (typeof host !== typeof "string") {
            log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - Bad host, not a string", 1);
            return ["FAIL"];
        }

        hints = this.addrinfo();
        hints.ai_flags = 0x0;
        hints.ai_family = this.AF_UNSPEC;
        hints.ai_socktype = 0;
        hints.ai_protocol = 0;
        hints.ai_addrlen = 0;

        addrinfo_ptr = this.addrinfo.ptr();
        ret = this.getaddrinfo(host, null, hints.address(), addrinfo_ptr.address());

        if (ret > 0 || addrinfo_ptr.isNull()) {
            log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - Got no results from getaddrinfo", 1);
            return ["FAIL"];
        }

        addrbuf   = (ctypes.char.array(128))();
        addresses = [];

        for (addrinfo = addrinfo_ptr; !addrinfo.isNull(); addrinfo = addrinfo.contents.ai_next) {
            if (addrinfo.contents.ai_addr.contents.sa_family === this.AF_INET) {
                sa = ctypes.cast(addrinfo.contents.ai_addr.contents, this.sockaddr_in);
                this.inet_ntop(sa.sin_family, sa.addressOfField("sin_addr"), addrbuf, 128);
                if (addresses.indexOf(addrbuf.readString()) === -1)
                {
                    addresses.push(addrbuf.readString());
                }
            }
            if (addrinfo.contents.ai_addr.contents.sa_family === this.AF_INET6) {
                sa = ctypes.cast(addrinfo.contents.ai_addr.contents, this.sockaddr_in6);
                this.inet_ntop(sa.sin6_family, sa.addressOfField("sin6_addr"), addrbuf, 128);
                if (addresses.indexOf(addrbuf.readString()) === -1)
                {
                    addresses.push(addrbuf.readString());
                }
            }
        }

        this.freeaddrinfo(addrinfo_ptr);

        log("Sixornot(dns_worker) - dns:resolve_remote(OSX) - Found the following addresses: " + addresses, 2);
        return addresses.slice();
    },

    shutdown : function () {
        "use strict";
        if (this.remote_ctypes || this.local_ctypes) {
            this.library.close();
        }
    }
};

importScripts("resource://sixornot/includes/ctypes/worker_base.js");

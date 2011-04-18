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

/* Portions of this code are based on the Flagfox extension by Dave Garrett.
 * Please see flagfox.net for more information on this extension.
 * */

/* ***** BEGIN LICENSE BLOCK *****
 * Version: MIT/X11 License
 * 
 * Copyright (c) 2011 Finnbarr P. Murphy
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * ***** END LICENSE BLOCK ***** */

/* ***** BEGIN LICENSE BLOCK *****
 * Version: MIT/X11 License
 * 
 * Copyright (c) 2010 Erik Vold
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * Contributor(s):
 *   Erik Vold <erikvvold@gmail.com> (Original Author)
 *   Greg Parris <greg.parris@gmail.com>
 *   Nils Maier <maierman@web.de>
 *
 * ***** END LICENSE BLOCK ***** */


/*
    Constants and global variables
*/
const {classes: Cc, interfaces: Ci, utils: Cu} = Components;
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/AddonManager.jsm");

const NS_XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
const BUTTON_ID     = "sixornot-buttonid",
      ADDRESS_BOX_ID = "sixornot-addressboxid",
      ADDRESS_IMG_ID = "sixornot-addressimageid",
      TOOLTIP_ID = "sixornot-tooltipid",
      ADDRESS_MENU_ID = "sixornot-addressmenuid",
      TOOLBAR_MENU_ID = "sixornot-toolbarmenuid",
      PREF_TOOLBAR  = "toolbar",
      PREF_NEXTITEM = "nextitem";

const PREF_BRANCH_SIXORNOT = Services.prefs.getBranch("extensions.sixornot.");

const PREFS = {
    enable:             false,
    nextitem:           "bookmarks-menu-button-container",
    toolbar:            "nav-bar",
    showaddressicon:    false
};

let PREF_OBSERVER = {
    observe: function (aSubject, aTopic, aData) {
        consoleService.logStringMessage("Sixornot - prefs observer");
        consoleService.logStringMessage("aSubject: " + aSubject + ", aTopic: " + aTopic.valueOf() + ", aData: " + aData);
        if (!(aTopic.valueOf() === "nsPref:changed"))
        {
            consoleService.logStringMessage("Sixornot - not a pref change event 1");
            return;
        }
        if (!PREFS.hasOwnProperty(aData))
        {
            consoleService.logStringMessage("Sixornot - not a pref change event 2");
            return;
        }

        consoleService.logStringMessage("Sixornot - prefs observer continues");
        consoleService.logStringMessage("Sixornot - aData is: " + aData);
        // If the changed preference is the addressicon one
        if (aData === "showaddressicon")
        {
            consoleService.logStringMessage("Sixornot - prefs observer - addressicon has changed");
            // Simply reload all addon's attributes
            reload();
        }

/*        // runOnWindows adds functionality into existing windows
        runOnWindows(function(win) {
            win.document.getElementById(KEY_ID).setAttribute(aData, getPref(aData));
            addMenuItem(win);
        }); */
    }
}

/*
    ipv6 only                   6only_16.png, 6only_24.png
    ipv4+ipv6 w/ local ipv6     6and4_16.png, 6and4_24.png
    ipv4+ipv6 w/o local ipv6    4pot6_16.png, 4pot6_24.png
    ipv4 only                   4only_16.png, 4only_24.png
    Unknown                     other_16.png, other_24.png
*/
let s6only_16 = "", s6and4_16 = "", s4pot6_16 = "", s4only_16 = "", sother_16 = "";
let s6only_24 = "", s6and4_24 = "", s4pot6_24 = "", s4only_24 = "", sother_24 = "";

(function(global) global.include = function include(src) (
    Services.scriptloader.loadSubScript(src, global)))(this);


/*
    Core functionality
*/
function main (win)
{
    consoleService.logStringMessage("Sixornot - main");
    let doc = win.document;

    // Add tooltip, iconized button and address bar icon to browser window
    // These are created in their own scope, they need to be found again using their IDs for the current window
    let (tooltip = doc.createElementNS(NS_XUL, "tooltip"),
         toolbarPopupMenu = doc.createElementNS(NS_XUL, "menupopup"),
         toolbarButton = doc.createElementNS(NS_XUL, "toolbarbutton"))
    {
        // Tooltip setup
        tooltip.setAttribute("id", TOOLTIP_ID);
        // Add event listener for tooltip showing (to update tooltip contents dynamically)
        tooltip.addEventListener("popupshowing", updateTooltipContent, false);

        // Menu setup
        toolbarPopupMenu.setAttribute("id", TOOLBAR_MENU_ID);
        toolbarPopupMenu.setAttribute("position", "after_start");
        // Add event listener for popupMenu opening (to update popupMenu contents dynamically)
        toolbarPopupMenu.addEventListener("popupshowing", updateMenuContent, false);
        toolbarPopupMenu.addEventListener("command", onMenuCommand, false);

        // Iconized button setup
        toolbarButton.setAttribute("id", BUTTON_ID);
        toolbarButton.setAttribute("label", getLocalizedStr("label"));
        toolbarButton.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional");
        toolbarButton.setAttribute("tooltip", TOOLTIP_ID);
        toolbarButton.setAttribute("type", "menu");
        toolbarButton.setAttribute("orient", "horizontal");

        toolbarButton.style.listStyleImage = "url('" + sother_16 + "')";

        // Menu which the button should open
        toolbarButton.appendChild(toolbarPopupMenu);

        gbi(doc, "navigator-toolbox").palette.appendChild(toolbarButton);

        // Add tooltip to urlbar (has to be added to something)
        gbi(doc, "urlbar-icons").appendChild(tooltip);
 
        // Move to location specified in prefs
        let toolbarId = PREF_BRANCH_SIXORNOT.getCharPref(PREF_TOOLBAR);
        let toolbar = toolbarId && gbi(doc, toolbarId);
        if (toolbar)
        {
            let nextItem = gbi(doc, PREF_BRANCH_SIXORNOT.getCharPref(PREF_NEXTITEM));
            toolbar.insertItem(BUTTON_ID, nextItem && nextItem.parentNode.id === toolbarId && nextItem);
        }

        // Add event listeners
        win.addEventListener("online", onChangedOnlineStatus, false);
        win.addEventListener("offline", onChangedOnlineStatus, false);
        win.addEventListener("aftercustomization", toggleCustomize, false);

    }
    // Add address bar icon only if desired by preferences
    if (PREF_BRANCH_SIXORNOT.getBoolPref("showaddressicon"))
    {
        let (addressPopupMenu = doc.createElementNS(NS_XUL, "menupopup"),
             addressIcon = doc.createElementNS(NS_XUL, "image"),
             addressButton = doc.createElementNS(NS_XUL, "box")) 
        {
            // Menu setup
            addressPopupMenu.setAttribute("id", ADDRESS_MENU_ID);
            addressPopupMenu.setAttribute("position", "after_start");
            // Add event listener for popupMenu opening (to update popupMenu contents dynamically)
            addressPopupMenu.addEventListener("popupshowing", updateMenuContent, false);
            addressPopupMenu.addEventListener("command", onMenuCommand, false);

            // Address bar icon setup
            addressButton.setAttribute("id", ADDRESS_BOX_ID);
            addressButton.setAttribute("width", "16");
            addressButton.setAttribute("height", "16");
            addressButton.setAttribute("align", "center");
            addressButton.setAttribute("pack", "center");

            addressIcon.setAttribute("id", ADDRESS_IMG_ID);
            addressIcon.setAttribute("tooltip", TOOLTIP_ID);
            addressIcon.setAttribute("popup", ADDRESS_MENU_ID);
            addressIcon.setAttribute("width", "16");
            addressIcon.setAttribute("height", "16");
            addressIcon.setAttribute("src", sother_16);

            // Position the icon
            let urlbaricons = gbi(doc, "urlbar-icons");
            let starbutton = gbi(doc, "star-button");
            addressButton.appendChild(addressIcon);
            addressButton.appendChild(addressPopupMenu);

            // If star icon visible, insert before it, otherwise just append to urlbaricons
            if (!starbutton)
            {
                urlbaricons.appendChild(addressButton);
            }
            else
            {
                urlbaricons.insertBefore(addressButton, starbutton);
            }

        }
    }

    // Set up variables for this instance
    var contentDoc = null;      // Reference to the current page document object
    var url = "";               // The URL of the current page
    var host = "";              // The host name of the current URL
    var ipv4s = [];             // The IP addresses of the current host
    var ipv6s = [];             // The IP addresses of the current host
    var localipv6s = [];        // Local IPv6 addresses
    var localipv4s = [];        // Local IPv4 addresses
    var usingv6 = null;         // True if we can connect to the site using IPv6, false otherwise
    var specialLocation = null;
    var DNSrequest = null;
    var pollLoopID = win.setInterval(pollForContentChange, 250);

    // Add a callback to our unload list to remove the UI when addon is disabled
    unload(function () {
        consoleService.logStringMessage("Sixornot - main unload function");
        // Get UI elements
        let toolbarButton = gbi(doc, BUTTON_ID) || gbi(gbi(doc, "navigator-toolbox").palette, BUTTON_ID);
        let tooltip = gbi(doc, TOOLTIP_ID);
        let toolbarPopupMenu = gbi(doc, TOOLBAR_MENU_ID);

        // Clear interval
        win.clearInterval(pollLoopID);

        // Clear event handlers
        win.removeEventListener("aftercustomization", toggleCustomize, false);
        win.removeEventListener("offline", onChangedOnlineStatus, false);
        win.removeEventListener("online", onChangedOnlineStatus, false);
        tooltip.removeEventListener("popupshowing", updateTooltipContent, false);
        toolbarPopupMenu.removeEventListener("popupshowing", updateMenuContent, false);
        toolbarPopupMenu.removeEventListener("command", onMenuCommand, false);

        // Remove UI
        tooltip && tooltip.parentNode.removeChild(tooltip);
        toolbarPopupMenu && toolbarPopupMenu.parentNode.removeChild(toolbarPopupMenu);
        toolbarButton && toolbarButton.parentNode.removeChild(toolbarButton);

        //DnsHandler.cancelRequest(DNSrequest);
    }, win);

    // If we loaded the address bar icon UI, add a callback to remove it on unload
    if (PREF_BRANCH_SIXORNOT.getBoolPref("showaddressicon"))
    {
        unload(function () {
            consoleService.logStringMessage("Sixornot - address bar unload function");
            // Get UI elements
            let addressPopupMenu = gbi(doc, ADDRESS_MENU_ID);
            let addressIcon = gbi(doc, ADDRESS_IMG_ID);
            let addressButton = gbi(doc, ADDRESS_BOX_ID);

            // Clear event handlers
            addressPopupMenu.removeEventListener("popupshowing", updateMenuContent, false);
            addressPopupMenu.removeEventListener("command", onMenuCommand, false);

            // Remove UI
            addressPopupMenu && addressPopupMenu.parentNode.removeChild(addressPopupMenu);
            addressIcon && addressIcon.parentNode.removeChild(addressIcon);
            addressButton && addressButton.parentNode.removeChild(addressButton);
        }, win);
    }


    /* Poll for content change to ensure this is updated on all pages including errors */
    function pollForContentChange ()
    {
        try
        {
            if (contentDoc !== win.content.document)
                updateState();
        }
        catch (e)
        {
            Components.utils.reportError("Sixornot EXCEPTION: " + parseException(e));
        }
    }

    /* Updates icon/tooltip etc. state if needed - called by the polling loop */
    function updateState ()
    {
        consoleService.logStringMessage("Sixornot - updateState");
/*        if (!ready)  // Startup not finished; wait...
        {
            if (ready === null)  // If aborted, unload
                unload();
            return;
        } */

        let addressIcon = gbi(doc, ADDRESS_IMG_ID);
        let toolbarButton = gbi(doc, BUTTON_ID) || gbi(gbi(doc, "navigator-toolbox").palette, BUTTON_ID);

        contentDoc = win.content.document;
        url = contentDoc.location.href;
        host = "";
        ipv6s = [];
        ipv4s = [];
        localipv6s = [];
        localipv4s = [];

        // If we've changed pages before completing a lookup, then abort the old request first
//        DnsHandler.cancelRequest(DNSrequest);
        DNSrequest = null;

        // Tries to update icon based on protocol type (e.g. for local pages which don't need to be looked up)
        // If this fails returns false and we need to do lookup
        if (updateIcon())
        {
            return;
        }

        // Need to look up host
        try {
            host = cropTrailingChar(contentDoc.location.hostname, ".");
        } 
        catch (e)
        {
            consoleService.logStringMessage("Sixornot - Unable to look up host");
        }
        if (host === "")
        {
            addressIcon.src = sother_16;
            toolbarButton.style.listStyleImage = "url('" + sother_16 + "')";
            specialLocation = ["unknownsite"];
            consoleService.logStringMessage("Sixornot warning: no host returned for \"" + url + "\"");
            return;
        }

        // Offline mode or otherwise not connected
        if (!win.navigator.onLine)
        {
            addressIcon.src = sother_16;
            toolbarButton.style.listStyleImage = "url('" + sother_16 + "')";
            specialLocation = ["offlinemode"];
            consoleService.logStringMessage("Sixornot is in offline mode");
            return;
        }

        // Proxy in use for DNS; can't do a DNS lookup
        if (DnsHandler.isProxiedDNS(url))
        {
            addressIcon.src = sother_16;
            toolbarButton.style.listStyleImage = "url('" + sother_16 + "')";
            specialLocation = ["nodnserror"];
            consoleService.logStringMessage("Sixornot is in proxied mode");
//            Sixornot.warning(window, "sixornot.warn.proxy", strings.GetStringFromName("proxywarnmessage"));
            return;
        }

        // Ideally just hitting the DNS cache here
//        DNSrequest = DnsHandler.resolveHost(host, onReturnedIPs);
        onReturnedIPs(DnsHandler.resolveHostNative(host));

        function onReturnedIPs(remoteips)
        {
            consoleService.logStringMessage("Sixornot - onReturnedIPs");
            DNSrequest = null;

            // DNS lookup failed
            if (remoteips[0] === "FAIL")
            {
                addressIcon.src = sother_16;
                toolbarButton.style.listStyleImage = "url('" + sother_16 + "')";
                specialLocation = ["lookuperror"];
                return;
            }

            let i = 0;

            // Update our local IP addresses (need these for the updateIcon phase, and they ought to be up-to-date)
            // Should do this via an async process to avoid blocking (but getting local IPs should be really quick!)
            let localips = DnsHandler.resolveLocal();

            // Parse list of local IPs for IPv4/IPv6
            for (i=0; i<localips.length; i++)
            {
                if (localips[i].indexOf(":") !== -1)
                {
                    localipv6s.push(localips[i]);
                }
                else
                {
                    localipv4s.push(localips[i]);
                }
            }

            // Parse list of IPs for IPv4/IPv6
            for (i=0; i<remoteips.length; i++)
            {
                if (remoteips[i].indexOf(":") !== -1)
                {
                    ipv6s.push(remoteips[i]);
                }
                else
                {
                    ipv4s.push(remoteips[i]);
                }
            }

            consoleService.logStringMessage("Sixornot - found IP addresses");

            // This must now work as we have a valid IP address
            updateIcon();
        }
    }


    /* Update the status icon state (icon & tooltip)
       Returns true if it's done and false if unknown */
    function updateIcon()
    {
        consoleService.logStringMessage("Sixornot - updateIcon");
        let addressIcon = gbi(doc, ADDRESS_IMG_ID);
        let toolbarButton = gbi(doc, BUTTON_ID) || gbi(gbi(doc, "navigator-toolbox").palette, BUTTON_ID);

        let loc_options = ["file:", "data:", "about:", "chrome:", "resource:"];

        function set_icon (icon)
        {
            // If this is null, address icon isn't showing
            if (addressIcon !== null)
            {
                addressIcon.src = icon;
            }
            toolbarButton.style.listStyleImage = "url('" + icon + "')";
        }

        // For any of these protocols, display "other" icon
        if (loc_options.indexOf(contentDoc.location.protocol) !== -1)
        {
            set_icon(sother_16);
            specialLocation = ["localfile"];
            return true;
        }

        // Unknown host -> still need to look up
        if (host === "")
        {
            return false;
        }

        // Valid URL, valid host etc., ready to update the icon
        if (ipv6s.length === 0)
        {
            // We only have IPv4 addresses for the website
            if (ipv4s.length === 0)
            {
                // No addresses at all, question mark icon
                set_icon(sother_16);
            }
            else
            {
                // v4 only icon
                set_icon(s4only_16);
            }
        }
        else
        {
            // We have at least one IPv6 address
            if (ipv4s.length === 0)
            {
                // We only have IPv6 addresses, v6 only icon
                set_icon(s6only_16);
            }
            else
            {
                // v6 and v4 addresses, depending on possibility of v6 connection display green or yellow
                if (localipv6s.length === 0)
                {
                    // Site has a v6 address, but we do not, so we're probably not using v6 to connect
                    set_icon(s4pot6_16);
                }
                else
                {
                    // Site has a v6 address as do we, so hopefully we're using v6 to connect
                    set_icon(s6and4_16);
                }
            }
        }
        specialLocation = null;
        return true;
    }

    // Called whenever an item on the menu is clicked and bound to each menu item as an event handler
    // Look up appropriate action by ID and perform that action
    function onMenuCommand (evt)
    {
        consoleService.logStringMessage("Sixornot - onMenuCommand");
        let commandID = evt.target.value;
        // Actions
        // "prefs" - Open preferences
        // "copyc" - Copy text to clipboard
        // "gotow" - Go to SixOrNot website
        // "taddr" - Show or hide the address bar icon
        if (commandID.substring(0,5) === "copyc")
        {
            consoleService.logStringMessage("Sixornot - onMenuCommand, copy to clipboard");
            clipboardHelper.copyString(commandID.substring(5));
        }
        /* if (commandID.substring(0,5) === "prefs")
        {
            consoleService.logStringMessage("Sixornot - onMenuCommand, open preferences");
        } */
        if (commandID.substring(0,5) === "gotow")
        {
            consoleService.logStringMessage("Sixornot - onMenuCommand, goto web page");
        }
        if (commandID.substring(0,5) === "taddr")
        {
            consoleService.logStringMessage("Sixornot - onMenuCommand, toggle address bar icon");
            // Toggle address bar icon visibility
            // This sets the preference, and the preference listener will take care of actually removing/adding the icon
            if (evt.target.hasAttribute("checked") && evt.target.getAttribute("checked") === "true")
            {
                consoleService.logStringMessage("Sixornot - onMenuCommand, set showaddressicon to true");
                PREF_BRANCH_SIXORNOT.setBoolPref("showaddressicon", true);
            }
            else
            {
                consoleService.logStringMessage("Sixornot - onMenuCommand, set showaddressicon to false");
                PREF_BRANCH_SIXORNOT.setBoolPref("showaddressicon", false);
            }
        }
    }

    // Update the contents of the popupMenu whenever it is opened
    function updateMenuContent (evt)
    {
        consoleService.logStringMessage("Sixornot - updateMenuContent");
        let popupMenu = this;

        // Clear previously generated popupMenu, if one exists
        while (popupMenu.firstChild)
        {
            popupMenu.removeChild(popupMenu.firstChild);
        }

        // labelName - displayed on menu item
        // ttText - tooltip for menu item
        // commandID - string of arbitrary data
        //  first 5 characters determine function call
        //  rest of string (if any) is data to use for function call
        function addMenuItem(labelName, ttText, commandID)
        {
            let (menuitem = doc.createElementNS(NS_XUL, "menuitem"))
            {
                menuitem.setAttribute("label", labelName);
                menuitem.setAttribute("tooltiptext", ttText);
                menuitem.setAttribute("value", commandID);
                popupMenu.appendChild(menuitem);
            }
        }
        function addToggleMenuItem(labelName, ttText, commandID, initialState)
        {
            let (menuitem = doc.createElementNS(NS_XUL, "menuitem"))
            {
                menuitem.setAttribute("label", labelName);
                menuitem.setAttribute("tooltiptext", ttText);
                menuitem.setAttribute("value", commandID);
                menuitem.setAttribute("type", "checkbox");
//                menuitem.setAttribute("autocheck", true);
                menuitem.setAttribute("checked", initialState);
                popupMenu.appendChild(menuitem);
            }
        }
        function addDisabledMenuItem(labelName)
        {
            let (menuitem = doc.createElementNS(NS_XUL, "menuitem"))
            {
                menuitem.setAttribute("label", labelName);
                menuitem.setAttribute("disabled", true);
                popupMenu.appendChild(menuitem);
            }
        }
        function addMenuSeparator()
        {
            let (menuseparator = doc.createElementNS(NS_XUL, "menuseparator"))
            {
                popupMenu.appendChild(menuseparator);
            }
        }


        if (ipv4s.length !== 0 || ipv6s.length !== 0 || host !== "")
        {
            if (host !== "")
            {
                // If host is an IP address and appears in either array of addresses do not display as hostname
                // (This would occur if the URL contains an IP address rather than a hostname)
                if (ipv4s.indexOf(host) === -1 && ipv6s.indexOf(host) === -1)
                {
                    // Build string containing list of all IP addresses (for copying to clipboard)
                    let remotestring = host;
                    if (ipv6s.length !== 0)
                    {
                        for (i=0; i<ipv6s.length; i++)
                        {
                            remotestring = remotestring + ", " + ipv6s[i];
                        }
                    }
                    if (ipv4s.length !== 0)
                    {
                        for (i=0; i<ipv4s.length; i++)
                        {
                            remotestring = remotestring + ", " + ipv4s[i];
                        }
                    }
                    addMenuItem(host, "Click to copy all data for this domain to clipboard", "copyc" + remotestring);
                }
                else
                {
                    // In this case there will only ever be one IP address record
                    addDisabledMenuItem("Hostname is IP address");
                }
            }
            else
            {
                addDisabledMenuItem("No Hostname found");
            }

            if (ipv6s.length !== 0)
            {
                for (i=0; i<ipv6s.length; i++)
                {
                    addMenuItem(ipv6s[i], "Click to copy IP address to clipboard", "copyc" + ipv6s[i]);
                }
            }
            if (ipv4s.length !== 0)
            {
                for (i=0; i<ipv4s.length; i++)
                {
                    addMenuItem(ipv4s[i], "Click to copy IP address to clipboard", "copyc" + ipv4s[i]);
                }
            }
        }
        else
        {
            addDisabledMenuItem("No remote site loaded");
        }
        addMenuSeparator();

        // Produce string containing all IP data for copy
        let localstring = dnsService.myHostName;
        if (localipv6s.length !== 0)
        {
            for (i=0; i<localipv6s.length; i++)
            {
                localstring = localstring + ", " + localipv6s[i];
            }
        }
        if (localipv4s.length !== 0)
        {
            for (i=0; i<localipv4s.length; i++)
            {
                localstring = localstring + ", " + localipv4s[i];
            }
        }

        addMenuItem(dnsService.myHostName + " (localhost)", "Click to copy all data for local host to clipboard", "copyc" + localstring);

        if (localipv6s.length !== 0)
        {
            for (i=0; i<localipv6s.length; i++)
            {
                addMenuItem(localipv6s[i], "Click to copy IP address to clipboard", "copyc" + localipv6s[i]);
            }
        }
        if (localipv4s.length !== 0)
        {
            for (i=0; i<localipv4s.length; i++)
            {
                addMenuItem(localipv4s[i], "Click to copy IP address to clipboard", "copyc" + localipv4s[i]);
            }
        }

        addMenuSeparator();
//        addMenuItem("Preferences...", "Click to open preferences dialog", "prefs");
        addToggleMenuItem("Show Addressbar Icon", "Toggles display of SixOrNot icon in Address Bar", "taddr", PREF_BRANCH_SIXORNOT.getBoolPref("showaddressicon"));

        addMenuSeparator();
        addMenuItem("Go to SixOrNot website", "Visit the SixOrNot website", "gotow" + "http://entropy.me.uk/sixornot/");
    }

    // Update the contents of the tooltip whenever it is shown
    function updateTooltipContent (evt)
    {
        consoleService.logStringMessage("Sixornot - updateTooltipContent");
        let tooltip = this;

        // Clear previously generated tooltip, if one exists
        while (tooltip.firstChild)
        {
            tooltip.removeChild(tooltip.firstChild);
        }

        let grid = doc.createElement("grid");
        let rows = doc.createElement("rows");

        let first = true;
        let i = null;

        function addSpacerLine()
        {
            let (row = doc.createElementNS(NS_XUL, "row"),
                 label = doc.createElementNS(NS_XUL, "label"),
                 value = doc.createElementNS(NS_XUL, "label"))
            {
                label.setAttribute("value", " ");
                row.appendChild(value);
                row.appendChild(label);
                rows.appendChild(row);
            }
        }

        function addTitleLine(labelName)
        {
            let (row = doc.createElementNS(NS_XUL, "row"),
                 label = doc.createElementNS(NS_XUL, "label"),
                 value = doc.createElementNS(NS_XUL, "label"))
            {
                label.setAttribute("value", labelName);
                label.setAttribute("style", "font-weight: bold; text-align: right;");
                row.appendChild(value);
                row.appendChild(label);
                rows.appendChild(row);
            }
        }

        function addLabeledLine(labelName, lineValue)
        {
            let (row = doc.createElementNS(NS_XUL, "row"),
                 label = doc.createElementNS(NS_XUL, "label"),
                 value = doc.createElementNS(NS_XUL, "label"))
            {
                label.setAttribute("value", labelName);
                label.setAttribute("style", "font-weight: bold;");
                value.setAttribute("value", lineValue);
                row.appendChild(label);
                row.appendChild(value);
                rows.appendChild(row);
            }
        }

        function addUnLabeledLine(lineValue)
        {
            let (row = doc.createElementNS(NS_XUL, "row"),
                 label = doc.createElementNS(NS_XUL, "label"),
                 value = doc.createElementNS(NS_XUL, "label"))
            {
                value.setAttribute("value", lineValue);
                row.appendChild(label);
                row.appendChild(value);
                rows.appendChild(row);
            }
        }

        if (ipv4s.length !== 0 || ipv6s.length !== 0 || host !== "")
        {
            addTitleLine("Remote", "");
        }

        if (host !== "")
        {
            addLabeledLine("Domain name:", host);
        }

        first = true;
        if (ipv6s.length !== 0)
        {
            for (i=0; i<ipv6s.length; i++)
            {
                if (first)
                {
                    if (ipv6s.length === 1)
                    {
                        addLabeledLine("IPv6 address:", ipv6s[i]);
                    }
                    else
                    {
                        addLabeledLine("IPv6 addresses:", ipv6s[i]);
                    }
                    first = false;
                }
                else
                {
                    addUnLabeledLine(ipv6s[i]);
                }
            }
        }
        first = true;
        if (ipv4s.length !== 0)
        {
            for (i=0; i<ipv4s.length; i++)
            {
                if (first)
                {
                    if (ipv4s.length === 1)
                    {
                        addLabeledLine("IPv4 address:", ipv4s[i]);
                    }
                    else
                    {
                        addLabeledLine("IPv4 addresses:", ipv4s[i]);
                    }
                    first = false;
                }
                else
                {
                    addUnLabeledLine(ipv4s[i]);
                }
            }
        }

        if (specialLocation)
        {
            var extraString
            if (specialLocation[0] === "localfile")
            {
                extraString = "Local location";
            }
            if (specialLocation[0] === "lookuperror")
            {
                extraString = "Lookup error";
            }
            if (specialLocation[0] === "nodnserror")
            {
                extraString = "No local DNS access";
            }
            if (specialLocation[0] === "offlinemode")
            {
                extraString = "Offline mode";
            }

            if (specialLocation[1])
            {
                extraString += " (" + specialLocation[1] + ")";
            }
            let extraLine = doc.createElement("label");
            extraLine.setAttribute("value", extraString);
            if (["unknownsite", "lookuperror", "nodnserror", "offlinemode"].indexOf(specialLocation[0]) !== -1)
            {
                extraLine.setAttribute("style", "font-style: italic;");
            }
            rows.appendChild(extraLine);
        }

        if (localipv4s.length !== 0 || localipv6s.length !== 0)
        {
            addSpacerLine();
            addTitleLine("Local");
            addLabeledLine("Host name:", dnsService.myHostName);
        }

        // Append local IP address information
        // TODO - If address is link-local (or otherwise not globally routeable) then render it in italics
        first = true;
        if (localipv6s.length !== 0)
        {
            for (i=0; i<localipv6s.length; i++)
            {
                if (first)
                {
                    if (localipv6s.length === 1)
                    {
                        addLabeledLine("IPv6 address:", localipv6s[i]);
                    }
                    else
                    {
                        addLabeledLine("IPv6 addresses:", localipv6s[i]);
                    }
                    first = false;
                }
                else
                {
                    addUnLabeledLine(localipv6s[i]);
                }
            }
        }
        first = true;
        if (localipv4s.length !== 0)
        {
            for (i=0; i<localipv4s.length; i++)
            {
                if (first)
                {
                    if (localipv4s.length === 1)
                    {
                        addLabeledLine("IPv4 address:", localipv4s[i]);
                    }
                    else
                    {
                        addLabeledLine("IPv4 addresses:", localipv4s[i]);
                    }
                    first = false;
                }
                else
                {
                    addUnLabeledLine(localipv4s[i]);
                }
            }
        }

        grid.appendChild(rows);
        tooltip.appendChild(grid);
    }

    // Online/Offline events can trigger multiple times, reset contentDoc so that the next time the timer fires it'll be updated
    function onChangedOnlineStatus(event)
    {
        contentDoc = null;
    }
}



/*
    bootstrap.js API
*/
function startup (data)
{
    AddonManager.getAddonByID(data.id, function(addon, data) {
        consoleService.logStringMessage("Sixornot - setInitialPrefs");
//        setInitialPrefs();
        include(addon.getResourceURI("includes/utils.js").spec);
        include(addon.getResourceURI("includes/locale.js").spec);

        // Init DnsHandler
        DnsHandler.init();

        initLocalization(addon, "sixornot.properties");
        s6only_16 = addon.getResourceURI("images/6only_16.png").spec;
        s6and4_16 = addon.getResourceURI("images/6and4_16.png").spec;
        s4pot6_16 = addon.getResourceURI("images/4pot6_16.png").spec;
        s4only_16 = addon.getResourceURI("images/4only_16.png").spec;
        sother_16 = addon.getResourceURI("images/other_16.png").spec;
        s6only_24 = addon.getResourceURI("images/6only_24.png").spec;
        s6and4_24 = addon.getResourceURI("images/6and4_24.png").spec;
        s4pot6_24 = addon.getResourceURI("images/4pot6_24.png").spec;
        s4only_24 = addon.getResourceURI("images/4only_24.png").spec;
        sother_24 = addon.getResourceURI("images/other_24.png").spec;

//        let root = addon.getResourceURI("").spec;
        consoleService.logStringMessage("Sixornot - hasresource is:" + addon.hasResource("content/options.xul"));

        // Load into existing windows and set callback to load into any new ones too
        watchWindows(main);

        let prefs = PREF_BRANCH_SIXORNOT;
        prefs = prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        prefs.addObserver("", PREF_OBSERVER, false);

    });
}

// Reload addon in all windows, e.g. when preferences change
function reload ()
{
    consoleService.logStringMessage("Sixornot - reload");
    unload();
    watchWindows(main);
}

function shutdown (data, reason)
{
    consoleService.logStringMessage("Sixornot - shutdown");
    // Shutdown DnsHandler
    DnsHandler.shutdown();

    if (reason !== APP_SHUTDOWN)
    {
        unload();
        
        let prefs = PREF_BRANCH_SIXORNOT;
        prefs = prefs.QueryInterface(Components.interfaces.nsIPrefBranch2);
        prefs.removeObserver("", PREF_OBSERVER);
    }
}

function install ()
{
    consoleService.logStringMessage("Sixornot - install");
    setInitialPrefs();
}

function uninstall ()
{
    consoleService.logStringMessage("Sixornot - uninstall");
// If this is due to an upgrade then don't delete preferences?
// Some kind of upgrade function to potentially upgrade preference settings may be required
//   let value = PREF_BRANCH_HTML5TOGGLE.getBoolPref("enable");
    PREF_BRANCH_SIXORNOT.deleteBranch("");             
//   PREF_BRANCH_HTML5.setBoolPref('enable', value);
}


/*
    Utility functions
*/

// Update preference which determines location of button when loading into new windows
function toggleCustomize (evt)
{
    consoleService.logStringMessage("Sixornot - toggleCustomize");
    let toolbox = evt.target, toolbarId, nextItemId;
    let button = gbi(toolbox.parentNode, BUTTON_ID);
    if (button) {
        let parent = button.parentNode, nextItem = button.nextSibling;
        if (parent && parent.localName === "toolbar")
        {
            toolbarId = parent.id;
            nextItemId = nextItem && nextItem.id;
        }
    }
    PREF_BRANCH_SIXORNOT.setCharPref(PREF_TOOLBAR,  toolbarId || "");
    PREF_BRANCH_SIXORNOT.setCharPref(PREF_NEXTITEM, nextItemId || "");
}

// Return preference value, either from prefs store or from internal defaults
function getPref (name)
{
    consoleService.logStringMessage("Sixornot - getPref");
    try
    {
      return PREF_BRANCH_SIXORNOT.getComplexValue(name, Ci.nsISupportsString).data;
    }
    catch (e)
    {
    }
    return PREFS[name];
}

// Proxy to getElementById
function gbi (node, childId)
{
    if (node.getElementById)
    {
        return node.getElementById(childId);
    }
    else
    {
        return node.querySelector("#" + childId);
    }
}

// Set up initial values for preferences
function setInitialPrefs ()
{
    consoleService.logStringMessage("Sixornot - setInitialPrefs");
    let branch = PREF_BRANCH_SIXORNOT;
    for (let [key, val] in Iterator(PREFS))
    {
        if (typeof val === "boolean")
        {
            branch.setBoolPref(key, val);
        }
        else if (typeof val === "number")
        {
            branch.setIntPref(key, val);
        }
        else if (typeof val === "string")
        {
            branch.setCharPref(key, val);
        }
    }
}

// Returns a string version of an exception object with its stack trace
function parseException (e)
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
        return String(e) + " \n" + cleanExceptionStack(e.stack);
    }
}
// Undo conversion of resource:// urls into file:// urls in exceptions
function cleanExceptionStack (stack)
{
    try
    {
        const shortPath = "resource://sixornot/";
        const longPath = ioService.newChannel(shortPath, null, null).URI.spec;
        return stack.replace(new RegExp(longPath, "ig"), shortPath);
    }
    catch (e)
    {
        return stack;
    }
}

// String modification
function truncateBeforeFirstChar (str, character)
{
    let pos = str.indexOf(character);
    return (pos !== -1) ? str.substring(0, pos) : str.valueOf();
}
function truncateAfterLastChar (str, character)
{
    let pos = str.lastIndexOf(character);
    return (pos !== -1) ? str.substring(pos + 1) : str.valueOf();
}
function cropTrailingChar (str, character)
{
    return (str.charAt(str.length - 1) === character) ? str.slice(0, str.length - 1) : str.valueOf();
}


// Lazy getter services
function defineLazyGetter (getterName, getterFunction)
{
    this.__defineGetter__(getterName, function() {
        delete this[getterName];
        return this[getterName] = getterFunction.apply(this);
    });
}

defineLazyGetter("consoleService", function() {
    return Components.classes["@mozilla.org/consoleservice;1"]
                     .getService(Components.interfaces.nsIConsoleService);
});
defineLazyGetter("ioService", function() {
    return Components.classes["@mozilla.org/network/io-service;1"]
                     .getService(Components.interfaces.nsIIOService);
});
defineLazyGetter("proxyService", function() {
    return Components.classes["@mozilla.org/network/protocol-proxy-service;1"]
                     .getService(Components.interfaces.nsIProtocolProxyService);
});
defineLazyGetter("dnsService", function() {
    return Components.classes["@mozilla.org/network/dns-service;1"].getService(Components.interfaces.nsIDNSService);
});
defineLazyGetter("clipboardHelper", function() {
    return Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                     .getService(Components.interfaces.nsIClipboardHelper);
});


// The DNS Handler which does most of the work of the extension
var DnsHandler =
{
    AF_INET: null,
    AF_INET6: null,
    library: null,
    sockaddr: null,
    addrinfo: null,
    getaddrinfo: null,

    init : function ()
    {
        // Import ctypes module
        Cu.import("resource://gre/modules/ctypes.jsm");

        // Try each of these until one works, this will also determine our platform
        try
        {
            this.library = ctypes.open("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
            consoleService.logStringMessage("Sixornot - Running on OSX, opened library: '/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation'");
            // Address family
            this.AF_UNSPEC = 0;
            this.AF_INET = 2;
            this.AF_INET6 = 30;
            // Socket type
            this.SOCK_STREAM = 1;
            // Protocol
            this.IPPROTO_UNSPEC = 0;
        }
        catch(e)
        {
            consoleService.logStringMessage("Sixornot - Not running on OSX");
            try
            {
                this.library = ctypes.open("Ws2_32.dll");
                consoleService.logStringMessage("Sixornot - Running on Windows XP+, opened library: 'Ws2_32.dll'");
                // Flags
                this.AI_PASSIVE = 0x01;
                this.AI_CANONNAME = 0x02;
                this.AI_NUMERICHOST = 0x04;
                this.AI_ALL = 0x0100;
                this.AI_ADDRCONFIG = 0x0400;
                this.AI_NON_AUTHORITATIVE = 0x04000;
                this.AI_SECURE = 0x08000;
                this.AI_RETURN_PREFERRED_NAMES = 0x10000;
                // Address family
                this.AF_UNSPEC = 0;
                this.AF_INET = 2;
                this.AF_INET6 = 23;
                // Socket type
                this.SOCK_STREAM = 1;
//                this.SOCK_DGRAM = 2;
//                this.SOCK_RAW = 3;
//                this.SOCK_RDM = 4;
//                this.SOCK_SEQPACKET = 5;
                // Protocol
                this.IPPROTO_UNSPEC = 0;
                this.IPPROTO_TCP = 6;
                this.IPPROTO_UDP = 17;
//                this.IPPROTO_RM = 113;
            }
            catch(e)
            {
                consoleService.logStringMessage("Sixornot - Not running on Windows XP+");
                // Here we should degrade down to using Firefox's builtin methods
                return false;
            }
        }
        // Set up the structs we need
        this.sockaddr = ctypes.StructType("sockaddr", [
                            {sa_family : ctypes.unsigned_short},
                            {sa_data : ctypes.unsigned_char.array(28)}]);
        this.addrinfo = ctypes.StructType("addrinfo");
        this.addrinfo.define([
                            {ai_flags : ctypes.int}, 
                            {ai_family : ctypes.int}, 
                            {ai_socktype : ctypes.int}, 
                            {ai_protocol : ctypes.int}, 
                            {ai_addrlen : ctypes.int}, 
                            {ai_cannonname : ctypes.char.ptr}, 
                            {ai_addr : this.sockaddr.ptr}, 
                            {ai_next : this.addrinfo.ptr}]);
        // Set up the ctypes functions we need
        this.getaddrinfo = this.library.declare("getaddrinfo", ctypes.default_abi, ctypes.int, ctypes.char.ptr, ctypes.char.ptr, this.addrinfo.ptr, this.addrinfo.ptr.ptr);
    },

    shutdown : function ()
    {
        this.library.close();
    },

    typeof_ip4 : function (ip_address)
    {
        // For IPv4 addresses types are:
        /*
            local           127.0.0.0/24
            rfc1918         10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
            linklocal       169.254.0.0/16
            reserved        192.0.0.0/24, 240.0.0.0/4
            documentation   192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
            6to4relay       192.88.99.0/24
            benchmark       198.18.0.0/15
            multicast       224.0.0.0/4
        */
    },

    // Return the type of an IPv6 address
    typeof_ip6 : function (ip_address)
    {
        // Incoming IPv6 address must be normalised to fully-expanded format in lowercase
        // Then run patterns against it to determine its type
        // For IPv6 addresses types are:
        /*
            unspecified     ::/128                                      All zeros
            local           ::1/128         0000:0000:0000:0000:0000:0000:0000:0001
            linklocal       fe80::/10                                   Starts with fe8, fe9, fea, feb
            sitelocal       fec0::/10   (deprecated)
            uniquelocal     fc00::/7    (similar to RFC1918 addresses)  Starts with: fc or fd
            pdmulticast     ff00::/8                                    Starts with ff
            v4transition    ::ffff:0:0/96 (IPv4-mapped)                     Starts with 0000:0000:0000:0000:0000:ffff
                            ::ffff:0:0:0/96 (Stateless IP/ICMP Translation) Starts with 0000:0000:0000:0000:ffff:0000
                            0064:ff9b::/96 ("Well-Known" prefix)            Starts with 0064:ff9b:0000:0000:0000:0000
            6to4            2002::/16                                       Starts with 2002
            teredo          2001::/32                                       Starts with 2001:0000
            benchmark       2001:2::/48                                     Starts with 2001:0002:0000
            documentation   2001:db8::/32                                   Starts with 2001:0db8
        */
    },

    // Convert a base10 representation of a number into a base16 one (zero-padded to two characters, input number less than 256)
    to_hex : function (int_string)
    {
        let hex = Number(int_string).toString(16);
        if (hex.length < 2)
        {
            hex = "0" + hex;
        }
        return hex;
    },

    // Ensure decimal number has no spaces etc.
    to_decimal : function (int_string)
    {
        return Number(int_string).toString(10);
    },

    // Convert IP object into a Javascript string
    get_ip_str : function (address, address_family)
    {
        // Find everything between square brackets
        consoleService.logStringMessage("Sixornot - get_ip_str");
        let r = RegExp(/\[(.*?)\]/);
        let ip_array = r.exec(address.sa_data.toString())[0].split(",");

        consoleService.logStringMessage("Sixornot - get_ip_str - ip_array is: " + ip_array);
        if (address_family === this.AF_INET)
        {
            // IPv4 address
            // Stored in bytes 2-5 (zero-index)
            // [0, 0, 82, 113, 152, 84, 0, 0, 0, 0, 0, 0, 0, 0, 228, 92, 46, 126, 0, 0, 0, 128, 65, 0, 0, 0, 136, 52]
            let ip4_array = ip_array.slice(2,6);
            return [Number(ip4_array[0]), Number(ip4_array[1]), Number(ip4_array[2]), Number(ip4_array[3])].join(".");
        }
        if (address_family === this.AF_INET6)
        {
            // IPv6 address
            // Stored in bytes 6-21 (zero-index)
            // [0, 0, 0, 0, 0, 0, ||32, 1, 4, 112, 31, 9, 3, 152, 0, 0, 0, 0, 0, 0, 0, 2||, 0, 0, 0, 0, 56, 52]
            let ip6_array = ip_array.slice(6,22);

            // This code adapted from this example: http://phpjs.org/functions/inet_ntop:882
            let i = 0, m = "", c = [];
            for (i = 0; i < 16; i++) {
                c.push(((Number(ip6_array[i++]) << 8) + Number(ip6_array[i])).toString(16));
            }
            return c.join(':').replace(/((^|:)0(?=:|$))+:?/g, function (t) {
                m = (t.length > m.length) ? t : m;
                return t;
            }).replace(m || ' ', '::');
        }
    },

    // Proxy to native getaddrinfo functionality
    resolveHostNative : function (host)
    {
        consoleService.logStringMessage("Sixornot - resolveHostNative - resolving host: " + host);

        let hints = this.addrinfo();
        hints.ai_flags = 0x00;
        hints.ai_family = this.AF_UNSPEC;
        hints.ai_socktype = 0;
        hints.ai_protocol = this.IPPROTO_UNSPEC;
        hints.ai_addrlen = 0;

        let retValue = this.addrinfo();
        let retVal = retValue.address();
        let ret = this.getaddrinfo(host, null, hints.address(), retVal.address());
//        let ret = this.getaddrinfo(host, null, null, retVal.address());
        let addresses = [];
        let notdone = true;
        if (retVal.isNull())
        {
            consoleService.logStringMessage("Sixornot - resolveHostNative - Unable to resolve host, got no results from getaddrinfo");
            return [];
        }
        let i = retVal.contents;

        // Loop over the addresses retrieved by ctypes calls and transfer all of them into a javascript array
        while (notdone)
        {
            consoleService.logStringMessage("Sixornot - loop");

            let new_addr = this.get_ip_str(i.ai_addr.contents, i.ai_family);

            // Add to addresses array, strip duplicates as we go
            if (addresses.indexOf(new_addr) === -1)
            {
                addresses.push(new_addr);
            }
            if (i.ai_next.isNull())
            {
                i = null;
                notdone = false;
            }
            else
            {
                i = i.ai_next.contents;
            }
        }

        consoleService.logStringMessage("Sixornot - Found the following addresses: " + addresses);
        return addresses.slice();

    },

    isProxiedDNS : function (url)  // Returns true if the URL is set to have its DNS lookup proxied via SOCKS
    {
        var uri = ioService.newURI(url, null, null);
        var proxyinfo = proxyService.resolve(uri, 0);  // Finds proxy (shouldn't block thread; we already did this lookup to load the page)
        return (proxyinfo !== null) && (proxyinfo.flags & proxyinfo.TRANSPARENT_PROXY_RESOLVES_HOST);
        // "network.proxy.socks_remote_dns" pref must be set to true for Firefox to set TRANSPARENT_PROXY_RESOLVES_HOST flag when applicable
    },

    cancelRequest : function (request)
    {
        try { request.cancel(Components.results.NS_ERROR_ABORT); } catch(e) {}  // calls onLookupComplete() with status=Components.results.NS_ERROR_ABORT
    },

    // Return the IP addresses of the local host
    resolveLocal : function ()
    {
        let dnsresponse = dnsService.resolve(dnsService.myHostName, true);
        var IPAddresses = [];
        while (dnsresponse.hasMore())
        {
            IPAddresses.push(dnsresponse.getNextAddrAsString());
        }
        return IPAddresses;
    },

    resolveHost : function (host,returnIP)  // Returns request object
    {
        function fail(reason)
        {
            logErrorMessage("Sixornot warning: DNS lookup failure for \"" + host + "\": " + reason);
            returnIP(["FAIL"]);
        }

        var callback =
        {
            onLookupComplete : function (nsrequest, nsrecord, status)
            {
                if (status === Components.results.NS_ERROR_ABORT)
                    return;  // Ignore cancel

                if (status !== 0 || !nsrecord || !nsrecord.hasMore())
                {
                    fail( (status === Components.results.NS_ERROR_UNKNOWN_HOST) ? ("Unknown host") : ("status " + status) );
                    return;  // IP not found in DNS
                }

                var IPAddresses = [];
                while (nsrecord.hasMore())
                {
                    IPAddresses.push(nsrecord.getNextAddrAsString());
                }

                // Return array of all IP addresses found for this domain
                returnIP(IPAddresses)
            }
        };

        try
        {
            return dnsService.asyncResolve(host, 0, callback, threadManager.currentThread);
        }
        catch (e)
        {
            fail( "exception " + ((e.name && e.name.length) ? e.name : e) );
            return null;
        }
    }
};


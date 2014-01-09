/*
 Copyright 2013 Gitana Software, Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.

 You may obtain a copy of the License at
 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.

 For more information, please contact Gitana Software, Inc. at this
 address:

 info@gitanasoftware.com
 */

(function(root, factory) {

    /* CommonJS */
    if (typeof exports == 'object') {
        var $ = require("jquery");
        var io = require("socket");
        module.exports = factory($, io);
    }

    /* AMD module */
    else if (typeof define == 'function' && define.amd) {
        define(["jquery", "socket.io"], factory);
    }

    /* Browser global */
    else {
        var $ = root.$;
        var io = root.io;
        root.Spinner = factory($, io);
    }
}
(this, function($, io) {
    "use strict";

    var CLASS_INSIGHT = "insight";
    var ATTR_DATA_INSIGHT_ID = "data-insight-id";
    var ATTR_DATA_INSIGHT_NODE = "data-insight-node";

    var iidCounter = 0;

    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // utility functions
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    var makeArray = function(nonArray) {
        return Array.prototype.slice.call(nonArray);
    };
    var isFunction = function(obj) {
        return Object.prototype.toString.call(obj) === "[object Function]";
    };
    var isString = function(obj) {
        return (typeof obj == "string");
    };
    var copyInto = function(target, source, includeFunctions) {
        for (var i in source) {
            if (source.hasOwnProperty(i)) {
                if (isFunction(source[i])) {
                    if (includeFunctions) {
                        target[i] = source[i];
                    }
                }
                else {
                    target[i] = source[i];
                }
            }
        }
    };
    var createInsightId = function() {
        var str = window.location.protocol + window.location.hostname + ":" + window.location.port + window.location.pathname;
        var iid = hashcode(str) + "_" + iidCounter;
        iidCounter++;

        return iid;
    };
    var hashcode = function(str) {
        var hash = 0;
        if (str.length == 0) return hash;
        for (var i = 0; i < str.length; i++) {
            var char2 = str.charCodeAt(i);
            hash = ((hash<<5)-hash)+char2;
            hash = hash & hash; // Convert to 32bit integer
        }
        if (hash < 0) {
            hash = hash * -1;
        }
        return hash;
    };
    var insightId = function(el, id)
    {
        if (id)
        {
            if (!$(el).hasClass(CLASS_INSIGHT))
            {
                $(el).addClass(CLASS_INSIGHT);
            }

            $(el).attr(ATTR_DATA_INSIGHT_ID, id);
        }

        if ($(el).hasClass(CLASS_INSIGHT))
        {
            id = $(el).attr(ATTR_DATA_INSIGHT_ID);
        }

        return id;
    };
    var findNearestCloudCMSNode = function(el)
    {
        if (!el || $(el).length == 0)
        {
            return null;
        }

        var attr = $(el).attr(ATTR_DATA_INSIGHT_NODE);
        if (attr)
        {
            var repoId = null;
            var branchId = null;
            var nodeId = null;

            // structure is <repoId>/<branchId>/<nodeId>
            var i = attr.indexOf("/");
            if (i > -1)
            {
                repoId = attr.substring(0, i);
                var j = attr.indexOf("/", i+1);
                if (j > -1)
                {
                    branchId = attr.substring(i+1, j);
                    nodeId = attr.substring(j+1);
                }
            }

            return {
                "repositoryId": repoId,
                "branchId": branchId,
                "id": nodeId
            };
        }

        return findNearestCloudCMSNode($(el).parent());
    };



    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // contexts
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    // construct a map of provider functions
    // this can be overridden with config
    var CONTEXTS_DEFAULTS = {
        "user": function() {
            return {};
        },
        "source": function() {
            return {
                "user-agent": navigator.userAgent,
                "platform": navigator.platform
            };
        },
        "page": function() {
            return {
                "uri": window.location.pathname,
                "hash": window.location.hash,
                "fullUri": window.location.pathname + window.location.hash,
                "title": document.title
            };
        },
        "application": function() {
            return {
                "host": window.location.host,
                "hostname": window.location.hostname,
                "port": window.location.port,
                "protocol": window.location.protocol,
                "url": window.location.protocol + "//" + window.location.host
            };
        },
        "node": function(event) {

            var x = {};

            var descriptor = findNearestCloudCMSNode(event.currentTarget);
            if (descriptor)
            {
                x = {
                    "repositoryId": descriptor.repositoryId,
                    "branchId": descriptor.branchId,
                    "id": descriptor.id
                };
            }

            return x;
        },
        "attributes": function(event) {

            var map = {};

            var el = event.currentTarget;

            $.each(el.attributes, function(i, attribute)
            {
                var name = null;

                if (attribute.name.toLowerCase().indexOf("data-insight-") > -1)
                {
                    name = attribute.name.substring(13);
                }
                else if (attribute.name == "href")
                {
                    name = attribute.name;
                }

                if (name)
                {
                    map[name] = attribute.value;
                }
            });

            return map;
        }
    };

    var contexts = {};



    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // config
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    var config = {};



    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // worker objects
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    // the dispatcher which uses socket.io to fire messages over to server and listen for special events
    var Dispatcher = function() {

        var socket = io.connect();

        var QUEUE = [];
        var BUSY = false;

        // run a timeout process that periodically fires over socket.io. updates
        var syncFunction = function(callback)
        {
            if (BUSY)
            {
                callback();
                return;
            }

            BUSY = true;

            var queueLength = QUEUE.length;
            if (queueLength > 0)
            {
                try
                {
                    // copy into rows
                    var data = {
                        "warehouseId": config.warehouseId,
                        "rows": []
                    };
                    for (var i = 0; i < queueLength; i++) {
                        data.rows.push(QUEUE[i]);
                    }

                    console.log("Insight sending " + data.rows.length + " rows");

                    // send via socket.io
                    socket.emit("insight-push", data);

                    // strip down the queue
                    QUEUE = QUEUE.slice(queueLength);
                }
                catch (e)
                {
                    console.log(e);
                }
            }

            // unbusy
            BUSY = false;

            callback();
        };

        var f = function()
        {
            window.setTimeout(function() {
                syncFunction(function(err) {
                    f(); // repeat
                });
            }, 5000); // five seconds
        };
        f();

        var r = {};

        r.push = function(interaction)
        {
            QUEUE.push(interaction);
        };

        r.flush = function()
        {
            syncFunction(function(err) {
            });
        };

        return r;
    }();


    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // methods
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    var methods = {};

    /**
     * This is the "endSession" method which can be called at any time to end the current session.
     */
    methods.endSession = function()
    {
        var now = new Date().getTime();

        if (SESSION_KEY)
        {
            Dispatcher.push({
                "warehouseId": config.warehouseId,
                "event": {
                    "type": "end_session"
                },
                "timestamp": {
                    "ms": now
                },
                //"appKey": Insight.APPLICATION_KEY,
                "sessionKey": SESSION_KEY,
                "userKey": USER_KEY
            });

            SESSION_KEY = null;
        }
    };


    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // event capture logic
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    // a tag that is created on the browser side (here) to identify the session
    var SESSION_KEY = null;
    // a tag that is created on the browser side (here) to identify the user
    var USER_KEY = null;

    var startSession = function()
    {
        var now = new Date().getTime();

        // make sure we have a session started
        if (!SESSION_KEY)
        {
            // generate session and user keys
            SESSION_KEY = "SESSION_KEY_" + now;
            USER_KEY = "USER_KEY_" + now;

            // indicate that we started a session
            Dispatcher.push({
                "event": {
                    "type": "start_session"
                },
                "timestamp": {
                    "ms": now
                },
                //"appKey": Insight.APPLICATION_KEY,
                "sessionKey": SESSION_KEY,
                "userKey": USER_KEY,
                "page": contexts["page"](),
                "application": contexts["application"](),
                "user": contexts["user"](),
                "source": contexts["source"]()
            });
        }
    };

    var captureInteraction = function(event)
    {
        var now = new Date().getTime();

        // push the interaction
        Dispatcher.push({
            "event": {
                "type": event.type,
                "x": event.pageX,
                "y": event.pageY,
                "offsetX": event.offsetX,
                "offsetY": event.offsetY
            },
            "timestamp": {
                "ms": now
            },
            "element": {
                "id": event.currentTarget.id,
                "type": event.currentTarget.nodeName,
                "iid": insightId(event.currentTarget)
            },
            //"appKey": Insight.APPLICATION_KEY,
            "sessionKey": SESSION_KEY,
            "userKey": USER_KEY,
            "page": contexts["page"](),
            "application": contexts["application"](),
            "user": contexts["user"](),
            "source": contexts["source"](),
            "node": contexts["node"](event),
            "attributes": contexts["attributes"](event)
        });
    };



    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // binds events
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    var FunctionHandler = function(el, _config)
    {
        // el can either be a dom id or a dom element
        if (el && isString(el)) {
            el = $("#" + el);
        }

        if (!_config) {
            _config = {};
        }

        /**
         * If config is a string, then it is a method name
         * We support:
         *
         *    'endSession'
         *    'destroy'
         */
        var methodName = null;
        if (typeof(_config) == "string")
        {
            methodName = _config;
        }
        if (methodName)
        {
            return methods[methodName].call();
        }


        /**
         * Configuration:
         *
         *      {
         *          "contexts": {
         *              "node": function(event) {
         *              },
         *              "user": function(event) {
         *              },
         *              "source": function(event) {
         *              },
         *              "page": function(event) {
         *              },
         *              "application": function(event) {
         *              }
         *          },
         *          "events": ["click"],
         *          "host": <optional - either provided or picked from window.location>,
         *          "warehouseId": <optional - warehouse id>
         *      }
         */

        /**
         * Notes
         *
         *  The window.location.href is passed over to the server.  If "host" is provided in config, then that is used.
         *
         *  The server uses this to determine the Insight.APPLICATION_KEY and warehouseId is assumed to be "primary"
         *  unless provided in config.  warehouseId can also be specified in config.
         */

        // if events array not specified, assume 'click' event
        if (!_config.events)
        {
            _config.events = ["click"];
        }

        // config
        config = {};
        copyInto(config, _config);

        // contexts
        contexts = {};
        copyInto(contexts, CONTEXTS_DEFAULTS, true);
        if (config.contexts)
        {
            copyInto(contexts, config.contexts, true);
        }

        // walk through our items
        // for each item, if not already tracked, then:
        //
        //   - add class CLASS_INSIGHT
        //   - add attribute ATTR_DATA_INSIGHT_ID
        //   - bind event handlers
        //
        $(el).each(function() {

            if (!$(this).hasClass(CLASS_INSIGHT))
            {
                // this adds class CLASS_INSIGHT and also the attribute ATTR_DATA_INSIGHT_ID
                insightId($(this), createInsightId());

                // event handlers
                for (var i = 0; i < config.events.length; i++)
                {
                    var eventType = config.events[i];

                    $(this).bind(eventType, function(event) {

                        captureInteraction(event);

                        var url = this.toString();

                        // if an external domain, we custom handle the event trigger via a setTimeout
                        // so as to allow the socket to complete
                        //if (url.indexOf(document.domain) == -1)
                        //{
                            event.preventDefault();

                            Dispatcher.flush();

                            setTimeout(function() {

                                var a = document.createElement("a");
                                a.setAttribute("href", url);
                                a.style.display = "none";
                                var aElm = document.body.appendChild(a);
                                aElm.click();

                            }, 150);
                        //}
                    });
                }
            }
        });

        // start session
        startSession();
    };


    /////////////////////////////////////////////////////////////////////////////////////////////////
    //
    // jQuery Wrapper
    //
    /////////////////////////////////////////////////////////////////////////////////////////////////

    //$.insight = Insight;

    $.fn.insight = function()
    {
        var args = makeArray(arguments);

        // append this into the front of args
        var newArgs = [].concat(this, args);

        // invoke, hand back field instance
        return FunctionHandler.apply(this, newArgs);
    };

}));
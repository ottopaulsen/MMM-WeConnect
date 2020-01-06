// "use strict";

const NodeHelper = require("node_helper");
const weconnect = require("./weconnect");
const jsonpointer = require("jsonpointer");
const internetAvailable = require("internet-available");

let carData = new Map();

let resources = [
    // { path: '/-/msgc/get-new-messages', values: [
    // ]},
    // { path: '/-/vsr/request-vsr', values: [
    // ]},
    {
        path: '/-/vsr/get-vsr', values: [
            { sourceKey: '/vehicleStatusData/totalRange', key: 'range', label: 'Range', suffix: 'km' },
            { sourceKey: '/vehicleStatusData/batteryLevel', key: 'battery', label: 'Battery level', suffix: '%' },
        ]
    },
    {
        path: '/-/cf/get-location', values: [
            { sourceKey: '/position/lat', key: 'latitude', label: 'Latitude', suffix: '' },
            { sourceKey: '/position/lng', key: 'longitude', label: 'Longitude', suffix: '' },
        ]
    },
    {
        path: '/-/vehicle-info/get-vehicle-details', values: [
            { sourceKey: '/vehicleDetails/lastConnectionTimeStamp/0', key: 'lastConectionDate', label: 'Last connection date', suffix: '' },
            { sourceKey: '/vehicleDetails/lastConnectionTimeStamp/1', key: 'lastConectionTime', label: 'Last connection time', suffix: '' },
            { sourceKey: '/vehicleDetails/distanceCovered', key: 'distanceCovered', label: 'Distance', suffix: 'km' },
            { sourceKey: '/vehicleDetails/serviceInspectionData', key: 'service', label: 'Service in', suffix: '' },
        ]
    },
    {
        path: '/-/emanager/get-emanager', values: [
            { sourceKey: '/EManager/rbc/status/chargingState', key: 'charging', label: 'Charging', suffix: '' },
            { sourceKey: '/EManager/rbc/status/chargingRemaningHour', key: 'chargingRemainingHour', label: 'Remaining hours', suffix: 'h' },
            { sourceKey: '/EManager/rbc/status/chargingRemaningMinute', key: 'chargingRemainingMinute', label: 'Remaining minutes', suffix: 'm' },
            { sourceKey: '/EManager/rbc/status/pluginState', key: 'connectionState', label: 'Connection state', suffix: '' },
        ]
    }
];


module.exports = NodeHelper.create({

    start: function () {
        console.log(this.name + ': Starting node helper');
        this.loaded = false;
    },

    log: function (...args) {
        if (this.config.logging) {
            console.log(args);
        }
    },

    startReadingData: function () {
        this.readData();
        setInterval(() => {
            this.readData();
        }, this.config.refreshIntervalSeconds * 1000);
    },

    readData: function () {
        internetAvailable()
            .then(() => {
                carData.set("magicMirrorOnline", true);
                this.loginWeConnect(this.config)
                    .then(api => {
                        resources.forEach(resource => {
                            this.readCarData(api, resource);
                        });
                    })
                    .catch(err => {
                        console.log("Error logging in to We Connect: ", err);
                        carData.set("apiConnection", { label: "API Connection", value: "LOGIN ERROR", suffix: "" });
                        this.log('Sending data: ', carData);
                        this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
                    });
            })
            .catch(() => {
                console.log("Internet not available");
                carData.set("apiConnection", { label: "API Connection", value: "NO INTERNET", suffix: "" });
                this.log('Sending data: ', carData);
                this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
            });
    },

    loginWeConnect: function (config, me, retries = 1) {
        return new Promise((resolve, reject) => {
            this.log(this.name + ': Logging in to WeConnect (' + retries + ')');
            let self = this;
            weconnect.login(config.email, config.password)
                .then(api => {
                    self.log(self.name + ': Logged in to WeConnect');
                    self.loaded = true;
                    resolve(api);
                })
                .catch(err => {
                    console.log(self.name + ': ', err);
                    if (retries <= 2) {
                        console.log(self.name + 'Retrying');
                        resolve(self.loginWeConnect(config, me, retries + 1));
                    } else {
                        reject("Cannot log in to We Connect");
                    }
                });
        })
    },

    readCarData: function (api, resource) {
        this.log(this.name + ': Reading car data for ' + resource.path);

        api(resource.path)
            .then(data => {
                if (this.config.logging) {
                    // The log args fucks up the formatting, so must use console.log here
                    console.log('data: ', data);
                    console.log('Got data for ' + resource.path + ': ', JSON.stringify(JSON.parse(data), null, 2));
                }

                if (resource.path == '/-/cf/get-location') {
                    driving = data == '{"errorCode":"0"}' ? "YES" : "NO";
                    carData.set("driving", { label: "Driving", value: driving, suffix: "" });
                }

                carData.set("apiConnection", {
                    label: "API Connection",
                    value: jsonpointer.get(JSON.parse(data), '/errorCode') == 0 ? "OK" : "ERROR",
                    suffix: ""
                });

                resource.values.forEach((value, key) => {
                    let res = jsonpointer.get(JSON.parse(data), value.sourceKey);
                    carData.set(value.key, {
                        label: value.label,
                        value: res,
                        suffix: value.suffix
                    });
                });
                this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
            })
            .catch(err => {
                console.log('Error reading car data (' + resource.path + '): ', err);
                resource.values.forEach((value, key) => {
                    carData.set(value.key, {
                        label: value.label,
                        value: "",
                        suffix: value.suffix
                    });
                });
            })
        // this.log('Sending data: ', carData);
        this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
    },


    socketNotificationReceived: function (notification, payload) {
        // this.log(this.name + ': Socket notification received: ', notification, ': ', payload);
        if (notification === 'WECONNECT_CONFIG') {
            var config = payload;
            this.config = config;
            this.startReadingData();
        }
    },
});

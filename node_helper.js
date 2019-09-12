const NodeHelper = require("node_helper");
const weconnect = require("./weconnect");
const jsonpointer = require("jsonpointer");
const internetAvailable = require("internet-available");

let carData = new Map();

module.exports = NodeHelper.create({

    resources: [
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
    ],

    start: function () {
        console.log(this.name + ': Starting node helper');
        this.loaded = false;
    },

    startReadingData: function () {
        this.readData();
        setInterval(() => {
            this.readData();
        }, this.config.refreshIntervalSeconds * 1000);
    },

    readData: function () {
        self = this;
        internetAvailable().then(function () {
            carData.set("magicMirrorOnline", true);
            self.loginWeConnect(self.config, (me) => {
                me.resources.forEach(resource => {
                    me.readCarData(resource);
                });
            }, self);
        }).catch(function () {
            console.log('No internet connection');
            carData.set("apiConnection", { label: "API Connection", value: "ERROR", suffix: "" });
            console.log('Sending data: ', carData);
            self.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
            return;
        });
    },

    loginWeConnect: async function (config, successFunction, me, retries = 1) {
        // console.log(this.name + ': Logging in to WeConnect (' + retries + ')');
        let self = this;
        weconnect.login(config.email, config.password)
            .then(res => {
                // console.log(self.name + ': Logged in to WeConnect');
                self.loaded = true;
                successFunction(me);
            })
            .catch(err => {
                console.log(self.name + ': Error logging in weconnect: ', err);
                if (retries <= 2) {
                    console.log(self.name + 'Retrying');
                    self.loginWeConnect(config, successFunction, retries + 1);
                }
            });
    },

    readCarData: function (resource) {
        // console.log(this.name + ': Reading car data for ' + resource.path);

        weconnect.api(resource.path)
            .then(data => {
                // console.log('Got data: ', JSON.stringify(JSON.parse(data), null, 2));

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
                    res = jsonpointer.get(JSON.parse(data), value.sourceKey);
                    carData.set(value.key, {
                        label: value.label,
                        value: res,
                        suffix: value.suffix
                    });
                })
                // console.log('Sending data: ', carData);
                this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
            })
            .catch(err => {
                console.log('Error reading car data: ', err);
            })
    },


    socketNotificationReceived: function (notification, payload) {
        console.log(this.name + ': Socket notification received: ', notification, ': ', payload);
        if (notification === 'WECONNECT_CONFIG') {
            var config = payload;
            this.config = config;
            this.startReadingData();
            // this.loginWeConnect(config);
        }
    },
});

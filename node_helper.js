const NodeHelper = require("node_helper");
const weconnect = require("./weconnect");
const jsonpointer = require("jsonpointer");

let carData = new Map();

module.exports = NodeHelper.create({

    resources: [
        // {intervalSeconds: 10, path: '/-/msgc/get-new-messages', values: [
        // ]},
        // {intervalSeconds: 10, path: '/-/vsr/request-vsr', values: [
        // ]},
        {
            intervalSeconds: 120, path: '/-/vsr/get-vsr', values: [
                { sourceKey: '/vehicleStatusData/totalRange', key: 'range', label: 'Range', suffix: 'km' },
                { sourceKey: '/vehicleStatusData/batteryLevel', key: 'battery', label: 'Battery level', suffix: '%' },
            ]
        },
        // {intervalSeconds: 10, path: '/-/cf/get-location', values: [
        // ]},
        {
            intervalSeconds: 300, path: '/-/vehicle-info/get-vehicle-details', values: [
                { sourceKey: '/vehicleDetails/lastConnectionTimeStamp/0', key: 'lastConectionDate', label: 'Last connection date', suffix: '' },
                { sourceKey: '/vehicleDetails/lastConnectionTimeStamp/1', key: 'lastConectionTime', label: 'Last connection time', suffix: '' },
                { sourceKey: '/vehicleDetails/distanceCovered', key: 'distanceCovered', label: 'Distance', suffix: 'km' },
                { sourceKey: '/vehicleDetails/serviceInspectionData', key: 'service', label: 'Service in', suffix: '' },
            ]
        },
        {
            intervalSeconds: 60, path: '/-/emanager/get-emanager', values: [
                { sourceKey: '/EManager/rbc/status/chargingState', key: 'charging', label: 'Charging', suffix: '' },
                { sourceKey: '/EManager/rbc/status/chargingRemaningHour', key: 'chargingRemainingHour', label: 'Remaining hours', suffix: 'h' },
                { sourceKey: '/EManager/rbc/status/chargingRemaningMinute', key: 'chargingRemainingMinute', label: 'Remaining minutes', suffix: '0' },
                { sourceKey: '/EManager/rbc/status/pluginState', key: 'connectionState', label: 'Connection state', suffix: '' },
            ]
        }
    ],

    start: function () {
        console.log(this.name + ': Starting node helper');
        this.loaded = false;
    },

    startReadingData: function () {
        this.resources.forEach(resource => {
            this.readCarData(resource);
        });
    },

    loginWeConnect: async function (config, retries = 1) {
        console.log(this.name + ': Logging in to WeConnect (' + retries + ')');
        let self = this;
        weconnect.login(config.email, config.password)
            .then(res => {
                console.log(this.name + ': Logged in to WeConnect');
                this.loaded = true;
                this.startReadingData();
            })
            .catch(err => {
                console.log(this.name + ': Error logging in weconnect: ', err);
                if (retries <= 2) {
                    console.log(this.name + 'Retrying');
                    self.loginWeConnect(config, retries + 1);
                }
            });
    },

    readCarData: function (resource) {
        console.log(this.name + ': Reading car data for ' + resource.path);

        weconnect.api(resource.path)
            .then(data => {
                console.log('Got data: ', data);
                resource.values.forEach((value, key) => {
                    res = jsonpointer.get(JSON.parse(data), value.sourceKey);
                    carData.set(value.key, {
                        label: value.label,
                        value: res,
                        suffix: value.suffix
                    });
                })
                console.log('Sending data: ', carData);
                this.sendSocketNotification('WECONNECT_CARDATA', JSON.stringify([...carData.entries()]));
                console.log('Waiting ' + resource.intervalSeconds + ' seconds to call again');
                setTimeout(() => {
                    this.readCarData(resource);
                }, 15000);
            })
            .catch(err => {
                console.log('Error reading car data: ', err);
                setTimeout(() => {
                    this.readCarData(resource);
                }, 15000);
                console.log('Trying again in ' + + 'seconds to call again');
            })
    },


    socketNotificationReceived: function (notification, payload) {
        console.log(this.name + ': Socket notification received: ', notification, ': ', payload);
        if (notification === 'WECONNECT_CONFIG') {
            var config = payload;
            this.config = config;
            this.loginWeConnect(config);
        }
    },
});


Module.register("MMM-WeConnect", {

    getScripts: function () {
        return [
            this.file('node_modules/jsonpointer/jsonpointer.js'),
            this.file('node_modules/svg.js/dist/svg.js')
        ];
    },

    // Default module config
    defaults: {
        refreshIntervalSeconds: 300,
        size: 300,
        showDistance: true,
        showPosition: true,
        showBatteryPercent: true,
        showRange: true,
        showConnectionStatus: true,
        showDriving: true,
        showBattery: true,
    },

    start: function () {
        console.log(this.name + ' started.');
        this.carData = [];
        this.loaded = true;
        this.sendSocketNotification('WECONNECT_CONFIG', this.config);
    },

    socketNotificationReceived: function (notification, payload) {
        var self = this;
        // console.log(self.name + ': Received socket notification ' + notification + ' with data ' + payload);
        if (notification === 'WECONNECT_CARDATA') {
            if (payload != null) {
                self.carData = JSON.parse(payload).reduce((m, [key, val]) => m.set(key, val), new Map());
                console.log('Parsed carData: ', self.carData);
                self.updateCar(self.carDrawing, self.carData, self.config);
            } else {
                console.log(self.name + ': WECONNECT_CARDATA - No payload');
            }
        }
    },

    getStyles: function () {
        return [
            'MMM-WeConnect.css'
        ];
    },

    getDom: function () {
        self = this;
        const wrapper = document.createElement("div");
        svgDiv = document.createElement("div");
        svgDiv.setAttribute("id", "carDrawing");
        wrapper.appendChild(svgDiv);

        setTimeout(() => {
            this.carDrawing = this.drawCar();
        }, 100)
        return wrapper;
    },

    degreesToRadians: function (degrees) {
        return degrees * Math.PI / 180;
    },

    distanceInMetersBetweenEarthCoordinates: function (lat1, lon1, lat2, lon2) {
        const earthRadiusKm = 6371;

        const dLat = this.degreesToRadians(lat2 - lat1);
        const dLon = this.degreesToRadians(lon2 - lon1);

        lat1 = this.degreesToRadians(lat1);
        lat2 = this.degreesToRadians(lat2);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadiusKm * c * 1000;
    },

    calculateAge: function (time) {
        const sec = Math.round((Date.now() - time) / 1000);
        if (sec < 45) return 'now'
        const min = Math.round(sec / 60)
        if (min < 60) return min + ' min'
        const h = Math.round(min / 60)
        if (h < 24) return h + ' hours'
        const d = Math.round(h / 24)
        return d + ' days'
    },

    findPosition: function (carData) {
        if (!carData.has("driving")) {
            if (carData.get("driving").value == "YES") {
                return "Driving"
            }
        }
        if (!carData.has("latitude")) {
            return "No position";
        }
        if (!this.config.positions) {
            return "";
        }
        let distanceFromHome = "";
        let closestPosition = "";
        let closestDistance = 999999999;
        this.config.positions.forEach(configPos => {
            let distance = this.distanceInMetersBetweenEarthCoordinates(
                carData.get("latitude").value,
                carData.get("longitude").value,
                configPos.lat,
                configPos.lon
            );
            if (distance < closestDistance) {
                closestDistance = distance;
                if(distance < configPos.marginMeters) {
                    closestPosition = configPos.name;
                }
            }
            if (configPos.name == this.config.homePosition) {
                distanceFromHome = "" + Math.round(distance / 100) / 10 + " km hjemmefra";
            }
        });
        return closestPosition || distanceFromHome || "";
    },

    drawCar: function () {
        const baseColor = "gray";
        const textColor = "#ccc";
        const batteryColor = "#666";
        const svg = SVG('carDrawing').size(this.config.size, this.config.size).viewbox(0, 0, 400, 400);
        const car = svg.group();
        const leftWheel = car.rect(40, 60).move(130, 200).radius(10).fill("black").stroke({ width: 3, color: baseColor });
        const rightWheel = car.rect(40, 60).move(320, 200).radius(10).fill("black").stroke({ width: 3, color: baseColor });
        const body = car.path("M100 150 v80 h290 v-80 a30 30 0 0 0 -30 -30 h-230 a30 30 0 0 0 -30 30")
            .stroke({ width: 10, color: baseColor })
            .fill(baseColor);
        const top = car.path("M140 120 v-40 a30 30 0 0 1 30 -30 h150 a30 30 0 0 1 30 30 v40")
            .stroke({ width: 10, color: baseColor });
        const leftLight = svg.circle(40).move(120, 140).fill("black");
        const rightLight = svg.circle(40).move(330, 140).fill("black");
        const cableConnected = svg.path("M100 160 h-20 a15 15 0 0 1 -15 -15 v-60 a15 15 0 0 0 -15 -15 h-50")
            .stroke({ width: 8, color: baseColor }).hide();
        const cableDisConnected = svg.path("M0 70 h20 a15 15 0 0 1 15 15 v180 m-5 15 v-10 a5 5 0 0 1 10 0 v10")
            .stroke({ width: 8, color: baseColor }).hide();
        const chargerBox = svg.rect(15, 50).move(0, 55).radius(2).fill(baseColor);
        const wall = svg.line(0, 0, 0, 300).stroke({ width: 1, color: baseColor });
        const charging = svg.polygon("60,65 90,25 100,35 130,10 100,55 90,45")
            .fill("yellow").rotate(-30).hide();
        const battery = svg.group();
        const batteryBody = battery.rect(130, 60).move(180, 162).radius(10).fill(batteryColor).hide();
        const batteryTop = battery.rect(12, 34).move(310, 175).radius(3).fill(batteryColor).hide();
        const batteryLevel = batteryBody.clone();
        const driver = svg.path("M195 120 a100 100 0 0 1 100 0")
            .stroke({ width: 10, color: baseColor }).fill(baseColor).hide();
        const driverHead = svg.circle(44).center(245, 86).fill(baseColor).hide();
        const antenna = svg.line(370, 120, 380, 10).stroke({ width: 3, color: baseColor });
        const antennaTop = svg.circle(5).center(380, 10).fill(baseColor);

        const distance = svg.text("").move(245, 230).font({ size: 22, anchor: "middle", fill: textColor });
        const batteryPercent = svg.text("").move(245, 155).font({ size: 40, anchor: "middle", fill: "yellow" });
        const range = svg.text("").move(245, 110).font({ size: 32, anchor: "middle", fill: "black", weight: 600 });
        const remainingChargingTime = svg.text("").move(10, -10).font({ size: 24, anchor: "start", fill: textColor });
        const position = svg.text("").move(245, 280).font({ size: 28, anchor: "middle", fill: textColor });
        const lastConnection = svg.text("We Connect").move(372, -10).font({ size: 20, anchor: "end", fill: textColor });

        if (!this.config.showConnectionStatus) lastConnection.hide();
        if (!this.config.showBattery) battery.hide();

        return {
            svg,
            body,
            top,
            leftLight,
            rightLight,
            leftWheel,
            rightWheel,
            cableConnected,
            cableDisConnected,
            chargerBox,
            wall,
            charging,
            distance,
            battery,
            batteryBody,
            batteryTop,
            batteryLevel,
            batteryPercent,
            range,
            remainingChargingTime,
            position,
            driver,
            driverHead,
            lastConnection,
            antenna,
            antennaTop
        }
    },

    updateCar: function (drawing, carData, config) {
        // console.log('carData: ', carData);

        // Distance covered
        if (config.showDistance && carData.has("distanceCovered")) {
            drawing.distance.text(carData.get("distanceCovered").value + " " + carData.get("distanceCovered").suffix).show();
        } else {
            drawing.distance.hide();
        }

        // Connection state
        if(carData.get("driving").value == "NO") {
            if (carData.has("connectionState")) {
                if (carData.get("connectionState").value == "CONNECTED") {
                    drawing.cableConnected.show();
                    drawing.cableDisConnected.hide();
                } else {
                    drawing.cableConnected.hide();
                    drawing.cableDisConnected.show();
                }
            }
            drawing.wall.show();
            drawing.chargerBox.show();
        } else {
            drawing.cableConnected.hide();
            drawing.cableDisConnected.hide();
            drawing.wall.hide();
            drawing.chargerBox.hide();
        }
            
        // Charging
        if (carData.has("charging")) {
            if (carData.get("charging").value == "CHARGING") {
                drawing.charging.show();
                drawing.remainingChargingTime.show();
                drawing.remainingChargingTime.text(
                    ""
                    + carData.get("chargingRemainingHour").value
                    + carData.get("chargingRemainingHour").suffix
                    + " "
                    + carData.get("chargingRemainingMinute").value
                    + carData.get("chargingRemainingMinute").suffix
                );
            } else {
                drawing.charging.hide();
                drawing.remainingChargingTime.hide();
            }
        }

        // Battery level
        if (carData.has("battery")) {
            const level = carData.get("battery").value;
            drawing.batteryBody.show();
            drawing.batteryTop.show();
            drawing.batteryLevel.width(drawing.batteryBody.width() * level / 100).show();
            let color = "green";
            if (level < 20) color = "red";
            else if (level < 50) color = "orange";
            else if (level < 75) color = "blue";
            else color = "green";
            drawing.batteryLevel.fill(color);

            if (config.showBatteryPercent) {
                drawing.batteryPercent.text("" + level + " " + carData.get("battery").suffix);
            }
            if (config.showRange) {
                drawing.range.text("" + carData.get("range").value + " " + carData.get("range").suffix);
            }
        }

        // Position
        if (config.showPosition) {
            if (carData.has("driving") && carData.get("driving").value == "NO" && carData.has("latitude")) {
                const p = this.findPosition(carData);
                drawing.position.text(p);
            } else {
                drawing.position.text("Kjører...");
            }
        }

        // Driving
        if (config.showDriving && carData.has("driving")) {
            if (carData.get("driving").value == "YES") {
                drawing.leftLight.fill("yellow");
                drawing.rightLight.fill("yellow");
                drawing.driver.show();
                drawing.driverHead.show();
                drawing.wall.hide();
                drawing.chargerBox.hide();
                drawing.cableConnected.hide();
                drawing.cableDisConnected.hide();
            } else {
                drawing.leftLight.fill("black");
                drawing.rightLight.fill("black");
                drawing.driver.hide();
                drawing.driverHead.hide();
                drawing.wall.show();
                drawing.chargerBox.show();
            }
        }

        // Last connection
        if (carData.has("apiConnection") && carData.get("apiConnection").value == "OK") {
            if (carData.has("lastConectionTime")) {
                time = carData.get("lastConectionDate").value + " " + carData.get("lastConectionTime").value;
                date = Date.parse(time);
                drawing.lastConnection.text(this.calculateAge(date));
            }
        } else {
            drawing.lastConnection.text("We don't connect");
        }
    }
});
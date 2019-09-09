
Module.register("MMM-WeConnect", {

    getScripts: function () {
        return [
            this.file('node_modules/jsonpointer/jsonpointer.js'),
            this.file('node_modules/svg.js/dist/svg.js')
        ];
    },

    // Default module config
    defaults: {
        refreshIntervalSeconds: 300
    },

    start: function () {
        console.log(this.name + ' started.');
        this.carData = [];
        this.loaded = true;

        this.sendSocketNotification('WECONNECT_CONFIG', this.config);

        // this.updateDom();

    },

    socketNotificationReceived: function (notification, payload) {
        var self = this;
        console.log(self.name + ': Received socket notification ' + notification + ' with data ' + payload);
        if (notification === 'WECONNECT_CARDATA') {
            if (payload != null) {
                self.carData = JSON.parse(payload).reduce((m, [key, val]) => m.set(key, val), new Map());
                console.log('Parsed carData: ', self.carData);
                self.updateCar(self.carDrawing, self.carData);
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

    isValueTooOld: function (maxAgeSeconds, updatedTime) {
        // console.log(this.name + ': maxAgeSeconds = ', maxAgeSeconds);
        // console.log(this.name + ': updatedTime = ', updatedTime);
        // console.log(this.name + ': Date.now() = ', Date.now());
        if (maxAgeSeconds) {
            if ((updatedTime + maxAgeSeconds * 1000) < Date.now()) {
                return true;
            }
        }
        return false;
    },

    getDom: function () {
        // console.log(self.name + ': getDom');
        self = this;

        var wrapper = document.createElement("div");

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
        var earthRadiusKm = 6371;

        var dLat = this.degreesToRadians(lat2 - lat1);
        var dLon = this.degreesToRadians(lon2 - lon1);

        lat1 = this.degreesToRadians(lat1);
        lat2 = this.degreesToRadians(lat2);

        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        console.log("Calculated distance: " + earthRadiusKm * c * 1000 + " meters");
        return earthRadiusKm * c * 1000;
    },

    findPosition : function (carData) {
        if(!carData.has("driving")) {
            if(carData.get("driving").value == "YES") {
                return "Driving"
            }
        }
        if(!carData.has("latitude")) {
            return "No position";
        }
        if(!this.config.positions) {
            return "";
        }
        let distanceFromHome = "";
        let positionName = "";
        this.config.positions.some(configPos => {
            console.log("Comparing to ", configPos);
            let distance = this.distanceInMetersBetweenEarthCoordinates(
                carData.get("latitude").value,
                carData.get("longitude").value,
                configPos.lat,
                configPos.lon
                );
            console.log("Calculated distance: " + distance + " meters");
            if(distance < configPos.marginMeters) {
                positionName = configPos.name;
                return true;
            }
            if(configPos.name == config.homePosition) {
                distanceFromHome = "" + distance + "m";
            }
            return false;
        });
        return positionName || distanceFromHome || "";
    },

    drawCar: function () {
        let svg = SVG('carDrawing').size('100%', '100%').viewbox(0, 0, 400, 300);
        let leftWheel = svg.rect(40, 60).move(130, 200).radius(10).fill("black").stroke({ width: 3, color: 'white' });
        let rightWheel = svg.rect(40, 60).move(320, 200).radius(10).fill("black").stroke({ width: 3, color: 'white' });
        let body = svg.path("M100 150 v80 h290 v-80 a30 30 0 0 0 -30 -30 h-230 a30 30 0 0 0 -30 30")
            .stroke({ width: 10, color: 'white' })
            .fill("white");
        let top = svg.path("M140 120 v-40 a30 30 0 0 1 30 -30 h150 a30 30 0 0 1 30 30 v40")
            .stroke({ width: 10, color: 'white' });
        let leftLight = svg.circle(40).move(120, 140).fill("black");
        let rightLight = svg.circle(40).move(330, 140).fill("black");
        let cableConnected = svg.path("M100 160 h-20 a15 15 0 0 1 -15 -15 v-60 a15 15 0 0 0 -15 -15 h-50")
            .stroke({ width: 8, color: 'white' }).hide();
        let cableDisConnected = svg.path("M0 70 h20 a15 15 0 0 1 15 15 v180 m-5 15 v-10 a5 5 0 0 1 10 0 v10")
            .stroke({ width: 8, color: 'white' }).hide();
        let chargerBox = svg.rect(15, 50).move(0, 55).radius(2).fill("white");
        let wall = svg.line(0, 0, 0, 300).stroke({ width: 1, color: "white" });
        let charging = svg.polygon("60,65 90,25 100,35 130,10 100,55 90,45")
            .fill("white").rotate(-30).hide();
        let distance = svg.text("").move(245, 230).font({ size: 22, anchor: "middle", fill: "white" });
        let battery = svg.rect(150, 64).move(170, 160).radius(10).fill("gray").hide();
        let batteryTop = svg.rect(12, 34).move(320, 175).radius(3).fill("gray").hide();
        let batteryLevel = battery.clone();
        let batteryPercent = svg.text("").move(245, 155).font({ size: 40, anchor: "middle", fill: "yellow" });
        let batteryDistance = svg.text("").move(245, 110).font({ size: 32, anchor: "middle", fill: "black", weight: 600 });
        let remainingChargingTime = svg.text("").move(10, -30).font({ size: 28, anchor: "start", fill: "white"});
        let position = svg.text("").move(400, 250).font({ size: 28, anchor: "end", fill: "white"});
        let driver = svg.path("M195 120 a100 100 0 0 1 100 0")
            .stroke({ width: 10, color: 'white' }).fill("white").hide();
        let driverHead = svg.circle(44).center(245,86).fill("white").hide();

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
            batteryTop,
            batteryLevel,
            batteryPercent,
            batteryDistance,
            remainingChargingTime,
            position,
            driver,
            driverHead
        }
    },

    updateCar: function (drawing, carData) {
        console.log('carData: ', carData);

        // Distance covered
        if (carData.has("distanceCovered")) {
            drawing.distance.text(carData.get("distanceCovered").value + " " + carData.get("distanceCovered").suffix);
        }

        // Connection state
        if (carData.has("connectionState")) {
            if (carData.get("connectionState").value == "CONNECTED") {
                drawing.cableConnected.show();
                drawing.cableDisConnected.hide();
            } else {
                drawing.cableConnected.hide();
                drawing.cableDisConnected.show();
            }
        }

        // Charging
        if (carData.has("charging")) {
            if (carData.get("charging").value == "ON") {
                drawing.charging.show();
                drawing.remainingChargingTime.show();
                drawing.remainingChargingTime.text(
                    ""
                    + chargingRemainingHour.value
                    + chargingRemainingHour.suffix
                    + " "
                    + chargingRemainingMinute.value
                    + chargingRemainingMinute.suffix
                );
            } else {
                drawing.charging.hide();
                drawing.remainingChargingTime.hide();
            }
        }

        // Battery level
        if (carData.has("battery")) {
            let level = carData.get("battery").value;
            drawing.battery.show();
            drawing.batteryTop.show();
            drawing.batteryLevel.width(drawing.battery.width() * level / 100).show();
            let color = "green";
            if (level < 20) color = "red";
            else if (level < 50) color = "orange";
            else if (level < 75) color = "blue";
            else color = "green";
            drawing.batteryLevel.fill(color);

            drawing.batteryPercent.text("" + level + " " + carData.get("battery").suffix);
            drawing.batteryDistance.text("" + carData.get("range").value + " " + carData.get("range").suffix);
        }

        // Position
        if (carData.has("driving") && carData.get("driving").value == "NO" && carData.has("latitude")) {
            console.log("Calling findPosition")
            let p = this.findPosition(carData);
            console.log("p: ", p);
            drawing.position.text(p);
        }

        // Driving
        if (carData.has("driving") ){
            if (carData.get("driving") == "YES") {
                drawing.leftLight.fill("yellow");
                drawing.rightLight.fill("yellow");
                drawing.driver.show();
                drawing.driverHead.show();
            } else {
                drawing.leftLight.fill("black");
                drawing.rightLight.fill("black");
                drawing.driver.hide();
                drawing.driverHead.hide();
            }
        }

    }
});
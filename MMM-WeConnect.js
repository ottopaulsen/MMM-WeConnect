
Module.register("MMM-WeConnect", {

    getScripts: function () {
        return [
            this.file('node_modules/jsonpointer/jsonpointer.js'),
            this.file('node_modules/svg.js/dist/svg.js')
        ];
    },

    // Default module config
    defaults: {

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
                self.updateCar();
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

    drawCar: function () {
        let svg = SVG('carDrawing').size('100%', '100%').viewbox(0, 0, 400, 300);
        let body = svg.path("M100 150 v80 h290 v-80 a30 30 0 0 0 -30 -30 h-230 a30 30 0 0 0 -30 30")
            .stroke({width: 10, color: 'white'})
            .fill("white");
        let top = svg.path("M140 120 v-50 a30 30 0 0 1 30 -30 h150 a30 30 0 0 1 30 30 v50")
            .stroke({width: 10, color: 'white'});
        let leftLight  = svg.circle(40).move(120, 140).fill("black");
        let rightLight = svg.circle(40).move(330, 140).fill("black");
        let leftWheel  = svg.rect(40, 60).move(130, 200).radius(10).fill("white");
        let rightWheel = svg.rect(40, 60).move(320, 200).radius(10).fill("white");
        let cableConnected = svg.path("M100 160 h-20 a15 15 0 0 1 -15 -15 v-60 a15 15 0 0 0 -15 -15 h-50")
            .stroke({width: 8, color: 'white'});
    

        return {
            svg,
            body,
            top,
            leftLight,
            rightLight,
            leftWheel,
            rightWheel
        }
    },

    updateCar: function () {
        // this.carDrawing.text.text("Updated");
        // this.carDrawing.svg.size('50%', '50%');
    }
});
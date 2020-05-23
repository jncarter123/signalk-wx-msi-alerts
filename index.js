const http = require('http')
const superagent = require('superagent')

const PLUGIN_ID = 'signalk-wx-msi-alerts'
const PLUGIN_NAME = 'Weather and Marine Safety Information Alerts'

const wxBasePath = 'notifications.weather.alerts'
const msiBasePath = 'notifications.msi'

const mapAlertTypes = [{
    "wx": "Warning",
    "sk": "alarm"
  },
  {
    "wx": "Statement",
    "sk": "alarm"
  },
  {
    "wx": "Advisory",
    "sk": "warn"
  },
  {
    "wx": "Watch",
    "sk": "alert"
  }
]

const eventTypes = [
  "Beach Hazards Statement",
  "Brisk Wind Advisory",
  "Coastal Flood Advisory",
  "Coastal Flood Statement",
  "Coastal Flood Warning",
  "Coastal Flood Watch",
  "Dense Fog Advisory",
  "Excessive Heat Warning",
  "Excessive Heat Watch",
  "Extreme Cold Warning",
  "Extreme Cold Watch",
  "Extreme Wind Warning",
  "Flash Flood Statement",
  "Flash Flood Warning",
  "Flash Flood Watch",
  "Flood Advisory",
  "Flood Statement",
  "Flood Warning",
  "Flood Watch",
  "Freeze Warning",
  "Freeze Watch",
  "Freezing Fog Advisory",
  "Freezing Rain Advisory",
  "Freezing Spray Advisory",
  "Frost Advisory",
  "Gale Warning",
  "Gale Watch",
  "Hard Freeze Warning",
  "Hard Freeze Watch",
  "Hazardous Seas Warning",
  "Hazardous Seas Watch",
  "Hazardous Weather Outlook",
  "Heat Advisory",
  "Heavy Freezing Spray Warning",
  "Heavy Freezing Spray Watch",
  "High Surf Advisory",
  "High Surf Warning",
  "High Wind Warning",
  "High Wind Watch",
  "Hurricane Force Wind Warning",
  "Hurricane Force Wind Watch",
  "Hurricane Local Statement",
  "Hurricane Warning",
  "Hurricane Watch",
  "Hydrologic Advisory",
  "Hydrologic Outlook",
  "Ice Storm Warning",
  "Lake Effect Snow Advisory",
  "Lake Effect Snow Warning",
  "Lake Effect Snow Watch",
  "Lake Wind Advisory",
  "Lakeshore Flood Advisory",
  "Lakeshore Flood Statement",
  "Lakeshore Flood Warning",
  "Lakeshore Flood Watch",
  "Low Water Advisory",
  "Marine Weather Statement",
  "Red Flag Warning",
  "Rip Current Statement",
  "Severe Thunderstorm Warning",
  "Severe Thunderstorm Watch",
  "Severe Weather Statement",
  "Small Craft Advisory",
  "Small Craft Advisory For Hazardous Seas",
  "Small Craft Advisory For Rough Bar",
  "Small Craft Advisory For Winds",
  "Special Marine Warning",
  "Special Weather Statement",
  "Storm Surge Warning",
  "Storm Surge Watch",
  "Storm Warning",
  "Storm Watch",
  "Tornado Warning",
  "Tornado Watch",
  "Tropical Depression Local Statement",
  "Tropical Storm Local Statement",
  "Tropical Storm Warning",
  "Tropical Storm Watch",
  "Tsunami Advisory",
  "Tsunami Warning",
  "Tsunami Watch",
  "Typhoon Local Statement",
  "Typhoon Warning",
  "Typhoon Watch",
  "Wind Advisory",
  "Wind Chill Advisory",
  "Wind Chill Warning",
  "Wind Chill Watch",
  "Winter Storm Warning",
  "Winter Storm Watch",
  "Winter Weather Advisory"
]

const mapNavareas = {
  "NAVAREA IV": "4",
  "HYDROLANT": "A",
  "NAVAREA XII": "12",
  "HYDROPAC": "P",
  "HYDROARC": "C"
}

module.exports = function(app) {
  var plugin = {}
  var wxAlertsTimer
  var msiTimer
  var alertOptions
  var msiAreas

  plugin.id = PLUGIN_ID;
  plugin.name = PLUGIN_NAME;
  plugin.description = "WX and MSI Alerts requires Internet connection."

  plugin.schema = function() {
    var schema = {
      type: "object",
      title: "Weather and MSI Alerts",
      properties: {}
    };

    var wxobj = {
      type: 'object',
      title: 'Weather',
      description: 'Weather provided by weather.gov and based on navigation.position.',
      properties: {
        enabled: {
          title: 'Enabled',
          type: 'boolean',
          default: false
        },
        refreshRate: {
          type: 'number',
          title: 'Refresh Rate in minutes',
          default: 5
        }
      }
    }
    schema.properties["wx"] = wxobj

    var msiobj = {
      type: 'object',
      title: 'Marine Safety Information (MSI)',
      description: 'MSI provided by msi.nga.gov',
      properties: {
        enabled: {
          title: 'Enabled',
          type: 'boolean',
          default: false
        },
        refreshRate: {
          type: 'number',
          title: 'Refresh Rate in minutes',
          default: 5
        },
        navareas: {
          type: "array",
          title: "NAVAREA",
          description: "Select one or more NAVAREAs",
          items: {
            type: "string",
            enum: [
              'NAVAREA IV',
              'NAVAREA XII',
              'HYDROLANT',
              'HYDROPAC',
              'HYDROARC'
            ]
          },
          minItems: 1,
          maxItems: 5,
          uniqueItems: true
        },
        distance: {
          type: 'number',
          title: 'Distance in nautical miles',
          description: 'Limit warnings within a specific distance of your current location. 0 will give all warnings in the NAVAREA.',
          default: 0
        }
      }
    }
    schema.properties["msi"] = msiobj

    return schema;
  }

  plugin.start = function(options) {
    alertOptions = options

    wxAlertsTimer = setInterval(function() {
      getWxAlerts()
      removeExpiredWxAlerts()
    }, alertOptions.wx.refreshRate * 60000)

    msiAreas = options.msi.navareas.map(area => mapNavareas[area])
    msiTimer = setInterval(function() {
      //do something
    }, alertOptions.msi.refreshRate * 60000)
  }

  plugin.stop = function() {
    if (wxAlertsTimer) {
      clearInterval(wxAlertsTimer)
    }

    if (msiTimer) {
      clearInterval(msiTimer)
    }
  }

  function handleDelta(values) {
    if (values.length == 0) {
      return
    }

    let delta = {
      "updates": [{
        "values": values
      }]
    }
    app.debug(JSON.stringify(delta))

    app.handleMessage(PLUGIN_ID, delta)
  }

  function processWxAlerts(alerts) {
    let values = []
    let alertsCount = 0

    alerts.features.forEach(feature => {
      let properties = feature.properties

      if (eventTypes.includes(properties.event)) {
        app.debug(`Event ${properties.event} not found in whitelist.`)
        return []
      }

      let event = toCamelCase(properties.event)
      let path = `${wxBasePath}.${event}.${properties.id}`

      if (properties.messageType == 'Cancel') {
        app.debug('Cancelling ' + properties.event)
        let existing = app.getSelfPath(path)

        if (existing) {
          values.push({
            "path": path,
            "value": null
          });
        }
      } else if (properties.messageType == 'Alert') {
        app.debug('Processing alert ' + properties.event)
        alertsCount++

        let skstate = mapAlertTypes.filter(alertType => properties.event.includes(alertType.wx))
        let alertState = skstate[0].sk

        let value = {
          "state": alertState,
          "method": [
            "visual",
            "sound"
          ]
        }

        value.message = properties.headline + '\n' + properties.description

        value.id = properties.id
        value.areaDesc = properties.areaDesc
        value.sent = properties.sent
        value.effective = properties.effective
        value.onset = properties.onset
        value.expires = properties.expires
        value.senderName = properties.senderName
        value.headline = properties.headline
        value.description = properties.description
        value.event = properties.event

        values.push({
          "path": path,
          "value": value
        });
      }
    })

    app.setProviderStatus(`${alertsCount} active alerts.`)

    return values
  }

  function removeExpiredWxAlerts() {
    let existing = app.getSelfPath(wxBasePath)
    app.debug('existing: ' + JSON.stringify(existing))

    if (existing) {
      let values = []
      let now = new Date().toISOString()
      let paths = findPaths(existing, 'expires')

      paths.forEach(path => {
        let expires = path.split('.').reduce((previous, current) => previous[current], existing)
        expires = new Date(expires).toISOString()

        if (now > expires) {
          let pathSplit = path.split('.')
          let notificationPath = wxBasePath + '.' + pathSplit.slice(0, pathSplit.length - 2).join('.')
          app.debug(`${notificationPath} has expired and is being removed.`)

          values.push({
            "path": notificationPath,
            "value": null
          });
        }
      })
      handleDelta(values)
    }
  }

  function getWxAlerts() {
    let position = app.getSelfPath('navigation.position')

    if (!position.value.latitude || !position.value.longitude) {
      app.setProviderError('GPS Data not available.')
      return
    }

    let point = position.value.latitude.toFixed(4) + "," + position.value.longitude.toFixed(4)

    let endPoint = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&point=' + point
    let userAgent = 'signalk-wx-msi-alerts,jncarter@hotmail.com'

    superagent
      .get(endPoint)
      .set('User-Agent', userAgent)
      .set('accept', 'application/geo+json')
      .then(res => {
        app.debug('wx alerts: ' + JSON.stringify(res.body))

        if (res.status === 200) {
          let notifications = processWxAlerts(res.body)
          handleDelta(notifications)
        } else {
          app.error('Error: ' + JSON.stringify(res))

          if (res.status === 400) {
            if (res.body.detail && res.body.detail.includes('out of bounds')) {
              app.setProviderError('Your position is currently outside of the NWS forecast area.')
            }
          } else {
            app.setProviderError('Unknown error, please review the error log.')
          }
        }
      })
      .catch(err => {
        app.error(err.message)
      })
  }

  function getMsiWarnings() {
    for (var area in msiAreas) {
      let endPoint = `https://msi.nga.mil/api/publications/broadcast-warn?status=active&navArea=${area}&output=json`

      superagent
        .get(endPoint)
        .then(res => {
          app.debug('msi warnings: ' + JSON.stringify(res.body))

          let notifications = processMSIWarnings(res.body)
          handleDelta(notifications)
        })
        .catch(err => {
          app.error(err.message)
        })
    }
  }

  function processMSIWarnings(warnings) {
    let values = [];

    for (var warning in warnings['broadcast-warn']) {
      let path = `${msiBasePath}.${event}.${properties.id}`

      app.debug('Processing warning ' + properties.event)

      let value = {
        "state": alertState,
        "method": [
          "visual",
          "sound"
        ]
      }

      value.message = warning.text

      value.msgYear = warning.msgYear
      value.msgNumber = warning.msgNumber
      value.navArea = warning.navArea
      value.subregion = warning.subregion
      value.text = warning.text
      value.status = warning.status
      value.issueDate = warning.issueDate
      value.authority = warning.authority
      value.cancelDate = warning.cancelDate
      value.cancelNavArea = warning.cancelNavArea
      value.cancelMsgYear = warning.cancelMsgYear
      value.cancelMsgNumber = warning.cancelMsgNumber
      value.year = warning.year
      value.area = warning.area
      value.number = warning.number

      values.push({
        "path": path,
        "value": value
      });
    }
    return values
  }

  function toCamelCase(input) {
    if (typeof input !== 'string') {
      return input
    }

    let regex = /[A-Z\xC0-\xD6\xD8-\xDE]?[a-z\xDF-\xF6\xF8-\xFF]+|[A-Z\xC0-\xD6\xD8-\xDE]+(?![a-z\xDF-\xF6\xF8-\xFF])|\d+/g
    let inputArray = input.match(regex)

    let result = ""
    for (let i = 0, len = inputArray.length; i < len; i++) {

      let currentStr = inputArray[i]
      let tempStr = currentStr.toLowerCase()

      if (i != 0) {
        tempStr = tempStr.substr(0, 1).toUpperCase() + tempStr.substr(1)
      }

      result += tempStr
    }

    return result
  }

  //https://www.geodatasource.com/developers/javascript
  function distance(lat1, lon1, lat2, lon2, unit) {
    if ((lat1 == lat2) && (lon1 == lon2)) {
      return 0
    } else {
      var radlat1 = Math.PI * lat1 / 180
      var radlat2 = Math.PI * lat2 / 180
      var theta = lon1 - lon2
      var radtheta = Math.PI * theta / 180
      var dist = Math.sin(radlat1) * Math.sin(radlat2) + Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta)
      if (dist > 1) {
        dist = 1
      }
      dist = Math.acos(dist);
      dist = dist * 180 / Math.PI
      dist = dist * 60 * 1.1515
      if (unit == "K") {
        dist = dist * 1.609344
      }
      if (unit == "N") {
        dist = dist * 0.8684
      }
      return dist
    }
  }

  function findPaths(obj, propName, value, prefix = '', store = []) {
    for (let key in obj) {
      const curPath = prefix.length > 0 ? `${prefix}.${key}` : key
      if (typeof obj[key] === 'object') {
        if (!propName || curPath.includes(propName)) {
          store.push(curPath)
        }
        findPaths(obj[key], propName, value, curPath, store);
      } else {
        if ((!propName || curPath.includes(propName)) &&
          (!value || obj[key] == value)) {
          store.push(curPath)
        }
      }
    }
    return store
  }

  return plugin
}

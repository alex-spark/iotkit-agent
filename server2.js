var mqtt = require('mqtt'),
    os = require("os"),
    fs =  require("fs"),
    mac = require("getmac"),
    express = require("express"),
    winston = require('winston'),
    dgram = require("dgram"),
    conf = process.env;


// Log
var logger = new (winston.Logger)({
  transports: [
    new (winston.transports.Console)({ 
        level: conf.CONSOLE_LOG_LEVEL || 'verbose',
        colorize: true
    }),
    new (winston.transports.File)({ 
        filename: process.env.AGENT_LOG_FILE || './agent.log',
        level: conf.FILE_LOG_LEVEL || 'warn'
    })
  ],
  exitOnError: false
});

// Start
logger.info('Configuring agent...');

// Local variables
var account_id, broker_topic;
var device_id = 'd-' + os.hostname().toLowerCase(); // default
logger.info('Device Id: %s', device_id);


// Message endpoint variables
var SERVER_MQTT_PORT = conf.SERVER_MQTT_PORT || 1883;
var SERVER_REST_PORT = conf.SERVER_REST_PORT || 8080;
var SERVER_UDP_PORT = conf.SERVER_UDP_PORT || 41234;
var BROKER_HOST = conf.BROKER_HOST || 'data.enableiot.com';
var BROKER_PORT = conf.BROKER_PORT || 8884;
var BROKER_DATA_TOPIC = "data2";
var BROKER_OPTS = {
   keyPath: conf.BROKER_HOST_KEY || 'certs/client.key',
   certPath: conf.BROKER_HOST_CERT || 'certs/client.crt',
   username: conf.BROKER_HOST_USR || 'username',
   password: conf.BROKER_HOST_PSW || 'password',
   keepalive: 30000
}

mac.getMac(function(err, macAddress){
    if (err) logger.error('Unable to get MAC address', err);
    device_id = macAddress; 
});

var getTimestamp = function(){
    return new Date().getTime();
}

var makeMetrics = function(data){

    if (!data) throw "Null val";

    var msg = {
       "device": device_id,
       "observations": data
    }

    // If in debug than print to console, else send to broker
    logger.info('Message: ', msg);
    broker.publish(broker_topic, JSON.stringify(msg));
}

// ************************************************************
// Local variables
// ************************************************************
account_id = BROKER_OPTS.username;
broker_topic = BROKER_DATA_TOPIC + "/" + account_id
broker = mqtt.createSecureClient(BROKER_PORT, BROKER_HOST, BROKER_OPTS);

// ************************************************************
// REST Server
// ************************************************************
var rest = express();
logger.info('Starting REST broker on %s ...', SERVER_REST_PORT);
rest.configure(function() {
    rest.use(express.favicon());
    rest.use(express.logger('dev'));
    rest.use(express.json());
    rest.use(express.urlencoded());
    rest.use(express.methodOverride());
    rest.use(express.errorHandler());
});

rest.put('/', function (request, response) {
    
    var msg = request.body;

    logger.info('REST Payload: ', msg);
    
    try {
        makeMetrics(msg);
        response.send(200);
    } catch (ex) {
        logger.error('Error on rest: %s', ex);
        response.send(404);
    }
});

rest.listen(SERVER_REST_PORT);

// ************************************************************
// UDP Server
// ************************************************************

var server = dgram.createSocket("udp4");

server.on("error", function (err) {
  logger.error('Error on rest: %s', err.stack);
  server.close();
});

server.on("message", function (msg, rinfo) {
  logger.info('UDP message from %s:%d', rinfo.address, rinfo.port);
  try {
    if (!msg) throw 'UDP: Null msg';
    else makeMetrics(JSON.parse(msg));
  } catch (ex) {
      logger.error('Error on udp: %s', ex);
  } 
  
});

server.on("listening", function () {
  var addr = server.address();
  logger.info('Starting UDP Server on %s:%d', addr.address, addr.port);
});

server.bind(SERVER_UDP_PORT);

// ************************************************************
// MQTT Server
// ************************************************************
logger.info('Starting MQTT broker on %s ...', SERVER_MQTT_PORT);
mqtt.createServer(function(client) {

  logger.info('Server created...');

  client.on('connect', function(packet) {
    client.connack({returnCode: 0});
    client.id = packet.clientId;
    logger.info('MQTT Client connected: %s', packet.clientId);
  });

  client.on('publish', function(packet) {
    logger.info('MQTT Topic: %s Payload: %s', packet.topic, packet.payload);
    //TODO: logic around topic
    makeMetrics(JSON.parse(packet.payload));
  });

  client.on('pingreq', function(packet) {
    client.pingresp();
  });

  client.on('disconnect', function(packet) {
    client.stream.end();
  });

  client.on('error', function(err) {
    client.stream.end();
    logger.error('MQTT Error: %s', err);
  });

}).listen(SERVER_MQTT_PORT);

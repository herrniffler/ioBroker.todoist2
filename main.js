/**
 Api erkärung:
 https://developer.todoist.com/rest/v2/
 Das ist ein test!
*/




/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';




// @ts-ignore
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapterName = require('./package.json').name.split('.').pop();
//const request = require("request");
// @ts-ignore
const axios = require('axios').default;
// @ts-ignore
const stringify = require('json-stringify-safe');
// @ts-ignore
const html_verarbeitung = require('./lib/html_verarbeitung.js');
const json_verarbeitung = require('./lib/json_verarbeitung.js');
const helper = require('./lib/helper_funktions.js');



let online_net = false;
let online_count = 0;
let poll;
let rechnen;
let uuid;
let adapter;
let debug;
let all_task_objekts = [];
let all_label_objekts = [];
let all_project_objekts = [];
let all_sections_objects = [];
let all_filter_objects = [];
let all_collaborators_objects = [];
let blacklist;
let sync;
let filter_list;
let bl_projects = [];
let bl_labels = [];
let bl_sections = [];

//Timeouts:
let timeoutdata =  null;
let timoutremove_old_obj = null;
let timeoutsyncron = null;

// intervall:
let mainintval = null;


async function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});

    adapter = new utils.Adapter(options);



    adapter.on('message', obj => {
        //adapter.log.info(JSON.stringify(obj));
        processMessages(obj).catch(err => adapter.log.error(`processMessages failed: ${err?.message || err}`));
        return true;
    });

    adapter.on('ready', () => {
        adapter.config.server = adapter.config.server === 'true';
        //hole States aus den Einstellungen und mache den Text kürzer :-)
        debug = adapter.config.debug;
        blacklist = adapter.config.blacklist;
        sync = adapter.config.sync;
        filter_list = adapter.config.filterlist;
        rechnen = adapter.config.pollingInterval/2;

        //adapter.log.warn("blacklist: " + blacklist.length);
        //adapter.log.warn("TESTEN_neu");
        //Hier leiten wir die Blacklist in 3 Arrays auf:
        for(var i = 0; i < blacklist.length; i++){
            if(blacklist[i].activ == true && blacklist[i].art == "project"){

                if(debug) adapter.log.warn("Projects found mit id: " + blacklist[i].id);
                bl_projects.push(blacklist[i]);
                if(debug) adapter.log.info("bl projects" + bl_projects);

            }
            if(blacklist[i].activ == true && blacklist[i].art == "label"){

                if(debug) adapter.log.warn("label found mit id: " + blacklist[i].id);
                bl_labels.push(blacklist[i]);
                if(debug) adapter.log.info("bl label" + bl_labels);

            }

            if(blacklist[i].activ == true && blacklist[i].art == "section"){

                if(debug) adapter.log.warn("Section found mit id: " + blacklist[i].id);
                bl_projects.push(blacklist[i]);
                if(debug) adapter.log.info("bl Section" + bl_sections);

            }

        }

        newstate();
        //subskribe um neue Stats anlegen zu können
        adapter.subscribeStates('Control.New.Task');
        adapter.subscribeStates('Control.Close.ID');

        //Subscribe wenn Task aktiv sind alle Tasks um dessen Änderung zu bearbeiten
        if(adapter.config.tasks == true){
        adapter.subscribeStates('Tasks.*');
        }
        //Grüner Punkt
        //check_online();

        //Main Sequenze
        //main();


        //Regelmäßige ausführung wie eingestellt
        poll = adapter.config.pollingInterval;

        if(poll < 10000){
            adapter.log.error("Polling under 10 Seconds, this is not supported and not working!");
        }
        if(poll < 60000){
            adapter.log.warn("It is recomended to use a intervall over 60 Seconds");
        }
        if(poll > 10000){
        //mainintval = (function(){main();}, 60000);
        main();
        mainintval = setInterval(main, poll);
        }
    });

    adapter.on('unload', (callback) => {
        try {
            adapter.log.info('cleaned everything up...');
                if (adapter && adapter.setState) adapter.setState('info.connection', false, true);
                //adapter.log.info(JSON.stringify(mainintval));
                mainintval && clearInterval(mainintval);
                mainintval = null;


            callback();
        } catch (e) {
            callback();
        }


    });




    // is called if a subscribed state changes
    adapter.on('stateChange', (id, state) => {

        //adapter.log.info("state: " + JSON.stringify(id));

        //Nur den Names des States nehmen.
        var pos = id.lastIndexOf('.');
        pos = pos +1;
        var end_pos = id.length;
        var new_id = id.substr(pos, end_pos);


        //adapter.log.info("state: " + JSON.stringify(state));

        //addTask(item, proejct_id, section_id, parent, order, label_id, priority, date, dupli)

        if(new_id == "Task"){
            //neuer Task über Objekte
            new_with_state(id, state);
        }else if(new_id == "ID"){


            //adapter.log.info("ausführen: " + state.val);

            // @ts-ignore
            closeTask(state.val);
            main();
        }else{
            //wenn ein Butten gedrückt wird in der Objekt liste.....
            state_task_delete(new_id, state);
        }

    });

    return adapter;
}


//Lösche einen Taks wenn der Butten gedrückt wird in der Objekte übersicht
async function state_task_delete(new_id, state){
if(state.val == true && state.val !== undefined){
    for(var i = 0; i < all_task_objekts.length; i++){
        if(all_task_objekts[i].content == new_id){
            //adapter.log.info("task aus der liste gefunden " + JSON.stringify(state));

            closeTask(all_task_objekts[i].id);
            adapter.delObject("Tasks." + new_id, function (err) {
                if (err) adapter.log.error('Cannot delete object: ' + err);
            });
        }
    }
}else if (state.val == true && state.val == undefined) {
    adapter.log.warn("function state_task_Delete is undefined, please report that issue");
}

}


//Erstelle neuen Task wenn der Objekt New.Task geänderd wird.
async function new_with_state(id, state){

    var new_project = await adapter.getStateAsync('Control.New.Project');
    var new_priority = await adapter.getStateAsync('Control.New.Priority');
    var new_date =  await adapter.getStateAsync('Control.New.Date');
    var new_label =  await adapter.getStateAsync('Control.New.Label');


    //wenn Felder leer sind dise auch löschen.
    if(new_priority == null|| new_priority.val === 0){new_priority = ""};
    if(new_date == null || new_date.val === 0){new_date = ""};
    if(new_label == null || new_label.val === 0){new_label = ""};
    if(new_project == null || new_project.val === 0){new_project = ""};
    //Debug ausgabe:
    if(debug) adapter.log.info("Anlage neues Todo mit Objekten");
    if(debug) adapter.log.info("Task: " + state.val);
    if(debug) adapter.log.info("Project: " + new_project.val);
    if(debug) adapter.log.info("Priorität: " + new_priority.val);
    if(debug) adapter.log.info("Date: " + new_date.val);
    if(debug) adapter.log.info("Label: " + new_label.val);

    //if(state.ack == false){
    //    adapter.log.warn("Please use Ack, only then the Task go to added");
    //}
    //if(state.akk){
    await addTask(state.val, new_project.val, "", "", "", new_label.val, new_priority.val, new_date.val, true);
    //}
}

//Baue neue States

async function newstate(){
    await adapter.setObjectNotExistsAsync("Control.New.Task", {
        type: 'state',
        common: {
            role: 'text',
            name: 'Task Name',
            type: 'string'

        },
        native: {}
          });
    await adapter.setObjectNotExistsAsync("Control.New.Project", {
            type: 'state',
            common: {
                role: 'state',
                name: 'Project ID',
                type: 'number'

            },
            native: {}
              });

    await adapter.setObjectNotExistsAsync("Control.New.Label", {
                type: 'state',
                common: {
                    role: 'state',
                    name: 'Label ID',
                    type: 'number'

                },
                native: {}
                  });

    await adapter.setObjectNotExistsAsync("Control.New.Priority", {
                    type: 'state',
                    common: {
                        role: 'value',
                        name: 'Priority',
                        type: 'number'

                    },
                    native: {}
                      });

    await adapter.setObjectNotExistsAsync("Control.New.Date", {
                        type: 'state',
                        common: {
                            role: 'date',
                            name: 'Date',
                            type: 'string'

                        },
                        native: {}
                          });

        await adapter.setObjectNotExistsAsync("Control.Close.ID", {
                type: 'state',
                common: {
                role: 'state',
                name: 'Task ID',
                type: 'number'

                },
                native: {}
                });

}

/**
 * Verarbeitet Kommandos aus obj.message.[funktion|function]
 * Erwartet ein Objekt wie z.B.:
 * { message: { funktion: "add_task", task: "…" , project_id: 123, … } }
 */
async function processMessages(obj) {
    const msg = obj?.message || {};
    // Abwärtskompatibel zu "funktion", optional modern "function" zulassen
    const action = msg.funktion ?? msg.function;

    // Map: Aktion -> { required: [...], handler: () => void }
    const routes = {
        add_task: {
            required: ["task"],
            handler: () =>
                addTask(
                    msg.task,
                    msg.project_id,
                    msg.section_id,
                    msg.parent_id,
                    msg.order,
                    msg.label_id,
                    msg.priority,
                    msg.date,
                    true
                ),
        },
        del_task: {
            required: ["task_id"],
            handler: () => delTask(msg.task_id),
        },
        add_project: {
            required: ["project"],
            handler: () => addProject(msg.project, msg.parent),
        },
        del_project: {
            required: ["project_id"],
            handler: () => dellProject(msg.project_id), // Tippfehler im Original beibehalten, falls Funktion so heißt
        },
        close_task: {
            required: ["task_id"],
            handler: () => closeTask(msg.task_id),
        },
        reopen_task: {
            required: ["task_id"],
            handler: () => reopenTask(msg.task_id),
        },
        add_section: {
            required: ["project_id", "section"],
            handler: () => addSection(msg.section, msg.project_id),
        },
        del_section: {
            required: ["section_id"],
            handler: () => delSection(msg.section_id),
        },
    };

    // Validierung: bekannte Aktion?
    if (!action || !routes[action]) {
        adapter.log.warn(
            `Unbekannte Funktion "${action}". Erlaubt: ${Object.keys(routes).join(", ")}`
        );
        return;
    }

    // Pflichtfelder prüfen (leere Strings und null ebenfalls abfangen)
    const missing = routes[action].required.filter(
        (k) => msg[k] === undefined || msg[k] === null || msg[k] === ""
    );
    if (missing.length) {
        adapter.log.warn(
            `Fehlende Pflichtfelder für "${action}": ${missing.join(", ")}`
        );
        if (obj.callback) {
            const result = { success: false, message: `Fehlende Felder: ${missing.join(", ")}` };
            adapter.sendTo(obj.from, obj.command, result, obj.callback);
        }
        return;
    }

    // Ausführen mit konsistentem Logging + Fehlerfang
    try {
        adapter.log.debug(`[${action}] Payload: ${JSON.stringify(msg)}`);
        const result = await routes[action].handler();
        adapter.log.info("Handler-Result: " + JSON.stringify(result));
        if (obj.callback) adapter.sendTo(obj.from, obj.command, result, obj.callback);
    } catch (err) {
        // @ts-ignore
        const message = err && err.message ? err.message : String(err);
        adapter.log.error(`Fehler bei "${action}": ${message}`);
        if (obj.callback) {
            const errorResult = { success: false, message };
            adapter.sendTo(obj.from, obj.command, errorResult, obj.callback);
        }
    }
}


function syncronisation(){

    for(var i = 0; i < all_task_objekts.length; i++){

    var sync_project_id = all_task_objekts[i].project_id;
    var sync_task_id = all_task_objekts[i].id;
    var sync_task_contend = all_task_objekts[i].content;


        for(var j = 0; j < sync.length; j++){

            var sync_quelle = sync[j].sync_id_q;
            var sync_ziel = sync[j].sync_id_z;
            var sync_activ = sync[j].sync_activ;
            var sync_delete = sync[j].sync_delete;


            if(sync_project_id == sync_quelle && sync_activ == true){



                                //adapter.log.warn("task: " + sync_task_contend);

                                 addTask(sync_task_contend, sync_ziel, "", "", "", "", "", "", false);
                                //adapter.log.info("ergebnist: ");

                                if(sync_delete == true){

                                closeTask(sync_task_id);
                                   // adapter.log.info("ergebnis2: ");


                                }



                    }


        }
    }
}





async function check_online(){
    var APItoken = adapter.config.token;


    await axios({
        method: 'get',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/projects',
        //responseType: 'json',
        headers:
           { Authorization: 'Bearer ' + APItoken}
    }).then(
        function (response) {

            //adapter.log.warn("axios check!! " + stringify(response, null, 2));
            //adapter.log.warn("axios check!! " + response.status);

            if(typeof response === 'object' && response.status == 200){
            	if(debug) adapter.log.warn("check online: " + JSON.stringify(response.status));
                adapter.setState('info.connection', true, true);
                online_net = true;


            }else{

            	adapter.setState('info.connection', false, true);
                adapter.log.warn("No Connection to todoist possible!!! Please Check your Internet Connection.")
                online_net = false;

            }
        }

        ).catch(

            function (error) {
                if (error.response) {
                    // The request was made and the server responded with a status code
                    adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                    adapter.setState('info.connection', false, true);
                    online_net = false;
                } else if (error.request) {
                    // The request was made but no response was received
                    // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                    // http.ClientRequest in node.js
                    adapter.log.info(error.message);
                    adapter.setState('info.connection', false, true);
                    online_net = false;

                } else {
                    // Something happened in setting up the request that triggered an Error
                    adapter.log.error(error.message);
                    adapter.setState('info.connection', false, true);
                    online_net = false;

                }
            }.bind(adapter)
 );
}


function createUUID(){
    var dt = new Date().getTime();
    uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = (dt + Math.random()*16)%16 | 0;
        dt = Math.floor(dt/16);
        return (c=='x' ? r :(r&0x3|0x8)).toString(16);
    });
    return uuid;
}

async function addTask(
    item,
    project_id,
    section_id,
    parent_id,
    order,
    label_id,
    priority,
    date,
    dupli
) {
    const dbg = (msg) => { adapter.log.debug(msg); };

    // Legacy: Der Aufrufer verwendet noch "proejct_id"? -> Abfangen:
    const legacyProjectId = project_id ?? arguments[1]; // Bewusst identisch – nur Kommentar für Leser
    // Tippfehler-Flag in config bleibt erhalten (dublicate), wir respektieren das:
    const duplicatesEnabled = adapter?.config?.dublicate === true;

    dbg("neuen Task anlegen starten…");
    dbg(`item: ${item}`);
    dbg(`project_id: ${legacyProjectId}`);
    dbg(`section_id: ${section_id}`);
    dbg(`parent_id: ${parent_id}`);
    dbg(`order: ${order}`);
    dbg(`label_id: ${JSON.stringify(label_id)}`);
    dbg(`priority: ${priority}`);
    dbg(`date: ${date}`);
    dbg(`dupli: ${dupli}`);

    // Feld-Normalisierung
    const toNum = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));
    const isSet = (v) => v !== "" && v !== null && v !== undefined;

    // 1) Duplikat-Prüfung (wenn in Config aktiv UND dupli == true)
    if (duplicatesEnabled && dupli === true) {
        if (debug) {
            adapter.log.warn("Starte Prüfung Duplikate");
            adapter.log.warn(`Object liste length: ${Array.isArray(all_task_objekts) ? all_task_objekts.length : "n/a"}`);
        }

        if (Array.isArray(all_task_objekts)) {
            const exists = all_task_objekts.some((t) => t && t.content === item);
            if (exists) {
                adapter.log.info("Objekt besteht schon und wird deshalb geblockt");
                return; // frühes Ende – kein Request
            }
        }
    }

    // 2) Request-Daten zusammenstellen (nur gesetzte Felder anfügen)
    const payload = { content: item };

    const pId = toNum(legacyProjectId);
    if (isSet(pId)) payload.project_id = pId;

    const sId = toNum(section_id);
    if (isSet(sId)) payload.section_id = sId;

    if (isSet(parent_id)) payload.parent_id = parent_id;

    const ord = toNum(order);
    if (isSet(ord)) payload.order = ord;

    // label_ids muss ein Array sein (Todoist REST v2)
    if (isSet(label_id)) {
        if (Array.isArray(label_id)) {
            payload.label_ids = label_id.map((x) => (typeof x === "number" ? x : Number(x))).filter((x) => !Number.isNaN(x));
        } else {
            const n = Number(label_id);
            payload.label_ids = Number.isNaN(n) ? [String(label_id)] : [n];
        }
    }

    const prio = toNum(priority);
    if (isSet(prio)) payload.priority = prio;

    if (isSet(date)) payload.due_string = date;

    dbg(`Daten zum Senden: ${JSON.stringify(payload)}`);

    // 3) Request absetzen
    const APItoken = adapter?.config?.token;
    if (!APItoken) {
        adapter.log.error("Kein API-Token in adapter.config.token gefunden.");
        return;
    }

    // Falls createUUID/uuid global existieren: nutzen; ansonsten eigene UUID erzeugen
    let requestId = typeof uuid !== "undefined" ? uuid : undefined;
    try {
        if (!requestId && typeof createUUID === "function") {
            createUUID();
            requestId = typeof uuid !== "undefined" ? uuid : undefined;
        }
    } catch (_) {
        // ignore
    }
    if (!requestId) {
        // Fallback: sehr simpler Request-Id Generator
        requestId = `ioBroker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    try {
        const response = await axios({
            method: "post",
            baseURL: "https://api.todoist.com",
            url: "/rest/v2/tasks",
            headers: {
                "Cache-Control": "no-cache",
                Authorization: `Bearer ${APItoken}`,
                "X-Request-Id": requestId,
                "Content-Type": "application/json",
            },
            data: payload,
            // timeout: 15000, // optional
        });

        adapter.log.debug("Task erfolgreich angelegt\n" + JSON.stringify(response?.data));
        // response.data enthält den angelegten Task (Objekt)
        return response?.data;
    } catch (error) {
        // @ts-ignore
        if (error && error.response) {
            adapter.log.warn(
                // @ts-ignore
                `received error ${error.response.status} response from todoist with content: ${JSON.stringify(error.response.data)}`
            );
            try {
                // @ts-ignore
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } catch (_) {
                // ignore
            }
            // @ts-ignore
        } else if (error && error.request) {
            // @ts-ignore
            adapter.log.info(String(error.message || error));
        } else {
            // @ts-ignore
            adapter.log.error(String(error?.message ?? error));
        }
    }
}


async function delTask(task_id){

	var APItoken = adapter.config.token;
        //purchItem = item + " " + anzahl + " Stück";

await axios({
    method: 'DELETE',
    baseURL: 'https://api.todoist.com',
    url: '/rest/v2/tasks/' + task_id,
    responseType: 'json',
    headers:
    {  Authorization: 'Bearer ' + APItoken, },
}
).then(
    function (response) {
        if(debug)adapter.log.info('lösche  Task: ' + response);
    }

).catch(

    function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
            adapter.log.warn(JSON.stringify(error.toJSON()));
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
           adapter.log.info(error.message);
        } else {
            // Something happened in setting up the request that triggered an Error
            adapter.log.error(error.message);
        }
}.bind(adapter)

);
}


async function addProject(project, parent){

	createUUID();
        var APItoken = adapter.config.token;
        //purchItem = item + " " + anzahl + " Stück";


await axios({
    method: 'post',
    baseURL: 'https://api.todoist.com',
    url: '/rest/v2/projects',
    responseType: 'json',
    headers:
    { 'Cache-Control': 'no-cache',
    Authorization: 'Bearer ' + APItoken,
    'X-Request-Id': uuid,
    'Content-Type': 'application/json' },
    data: { name: project,
        parent: parent
        }
}
).then(
    function (response) {
        if(debug)adapter.log.info('setzte neues Projekt: ' + response);
    }

).catch(

    function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
            adapter.log.warn(JSON.stringify(error.toJSON()));
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
           adapter.log.info(error.message);
        } else {
            // Something happened in setting up the request that triggered an Error
            adapter.log.error(error.message);
        }
}.bind(adapter)

);

}

async function dellProject(project_id){

    var APItoken = adapter.config.token;


    await axios({
        method: 'DELETE',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/projects/' + project_id,
        responseType: 'json',
        headers:
        {  Authorization: 'Bearer ' + APItoken, },
    }
    ).then(
        function (response) {
            if(debug)adapter.log.info('lösche  Projekt: ' + response);
        }

    ).catch(

        function (error) {
            if (error.response) {
                // The request was made and the server responded with a status code
                adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } else if (error.request) {
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
               adapter.log.info(error.message);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error(error.message);
            }
    }.bind(adapter)

    );

}


async function closeTask(task_id){
    var APItoken = adapter.config.token;


    await axios({
        method: 'POST',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/tasks/' + task_id + '/close',
        responseType: 'json',
        headers:
        {  Authorization: 'Bearer ' + APItoken, },
    }
    ).then(
        function (response) {
            if(debug)adapter.log.info('schließe  Task: ' + response);
        }

    ).catch(

        function (error) {
            if (error.response) {
                // The request was made and the server responded with a status code
                adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } else if (error.request) {
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
               adapter.log.info(error.message);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error(error.message);
            }
    }.bind(adapter)

    );

}



async function reopenTask(task_id){

	var APItoken = adapter.config.token;


    await axios({
        method: 'POST',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/tasks/' + task_id + '/reopen',
        responseType: 'json',
        headers:
        {  Authorization: 'Bearer ' + APItoken, },
    }
    ).then(
        function (response) {
            if(debug)adapter.log.info('wiederöffne  Task: ' + response);
        }

    ).catch(

        function (error) {
            if (error.response) {
                // The request was made and the server responded with a status code
                adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } else if (error.request) {
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
               adapter.log.info(error.message);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error(error.message);
            }
    }.bind(adapter)

    );


}


async function addSection(section, project_id){

	createUUID();
        var APItoken = adapter.config.token;
        //purchItem = item + " " + anzahl + " Stück";


await axios({
    method: 'post',
    baseURL: 'https://api.todoist.com',
    url: '/rest/v2/sections',
    responseType: 'json',
    headers:
    { 'Cache-Control': 'no-cache',
    Authorization: 'Bearer ' + APItoken,
    'X-Request-Id': uuid,
    'Content-Type': 'application/json' },
    data: { name: section,
        project_id: project_id,
        },
}
).then(
    function (response) {
        if(debug)adapter.log.info('setzte neue Section: ' + response);
    }

).catch(

    function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
            adapter.log.warn(JSON.stringify(error.toJSON()));
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
           adapter.log.info(error.message);
        } else {
            // Something happened in setting up the request that triggered an Error
            adapter.log.error(error.message);
        }
}.bind(adapter)

);

}



async function delSection(section_id){

	var APItoken = adapter.config.token;


await axios({
    method: 'DELETE',
    baseURL: 'https://api.todoist.com',
    url: '/rest/v2/sections/' + section_id,
    responseType: 'json',
    headers:
    {  Authorization: 'Bearer ' + APItoken, },
}
).then(
    function (response) {
        if(debug)adapter.log.info('lösche  Section: ' + response);
    }

).catch(

    function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
            adapter.log.warn(JSON.stringify(error.toJSON()));
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
           adapter.log.info(error.message);
        } else {
            // Something happened in setting up the request that triggered an Error
            adapter.log.error(error.message);
        }
}.bind(adapter)

);

}



async function getData(){



    if(debug) adapter.log.info("Funktion get Data");

	var APItoken = adapter.config.token;


    //Projekte einlesen:
    if(adapter.config.project === true){
                if(debug) adapter.log.info("get Projects");


                await axios({
                    method: 'get',
                    baseURL: 'https://api.todoist.com',
                    url: '/rest/v2/projects',
                    responseType: 'json',
                    headers:
                    { Authorization: 'Bearer ' + APItoken}
                }
                ).then(
                    function (response) {
                        //adapter.log.info('get Projects: ' + stringify(response, null, 2));
                        var projects_json = response.data;
                        all_project_objekts = projects_json;
                    }

                ).catch(

                    function (error) {
                        if (error.response) {
                            // The request was made and the server responded with a status code
                            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                            adapter.log.warn(JSON.stringify(error.toJSON()));
                        } else if (error.request) {
                            // The request was made but no response was received
                            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                            // http.ClientRequest in node.js
                        adapter.log.info(error.message);
                        } else {
                            // Something happened in setting up the request that triggered an Error
                            adapter.log.error(error.message);
                        }
            }.bind(adapter)

            );



    var project = { method: 'GET',
          url: 'https://api.todoist.com/rest/v2/projects',
          headers:
           { Authorization: 'Bearer ' + APItoken}
    };

    }


    // projekt Mitglieder Einlesen, wenn es Projekte mit mehren Mitgliedern gibt.
    // wird nur ausgeführt wenn Projekte auch ausgewählt ist!
    if(adapter.config.project_collaborators === true && adapter.config.project === true){

        //da all_collaborators_objects mit push gefüllt wird muss vor beginn geleert werden:
        all_collaborators_objects = [];

        //schleife durch alle Projekt daten:
        for(let x in all_project_objekts){
            let collaborators = [];
            //adapter.log.debug(JSON.stringify(all_project_objekts[x].shared));

            // nur wenn geschared ist gibt es Collaborators
            if(all_project_objekts[x].shared === true){
                if(debug) adapter.log.info("get Collaborators");

                await axios({
                    method: 'get',
                    baseURL: 'https://api.todoist.com',
                    url: '/rest/v2/projects/'+all_project_objekts[x].id +'/collaborators',
                    responseType: 'json',
                    headers:
                    { Authorization: 'Bearer ' + APItoken}
                }
                ).then(
                    function (response) {
                        //adapter.log.info('get Projects: ' + stringify(response, null, 2));
                        collaborators = response.data;
                    }

                ).catch(

                    function (error) {
                        if (error.response) {
                            // The request was made and the server responded with a status code
                            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                            adapter.log.warn(JSON.stringify(error.toJSON()));
                        } else if (error.request) {
                            // The request was made but no response was received
                            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                            // http.ClientRequest in node.js
                        adapter.log.info(error.message);
                        } else {
                            // Something happened in setting up the request that triggered an Error
                            adapter.log.error(error.message);
                        }
            }.bind(adapter)

            );
            collaborators.unshift("project_id:"+all_project_objekts[x].id);
            //zu all collaborators Objekts hinzufügen
            all_collaborators_objects.push(collaborators)

        }


        //ende for schleife
        }


        //adapter.log.debug(JSON.stringify(all_collaborators_objects));


    }


    //Labels einlesen:
    if(adapter.config.labels === true){


        if(debug) adapter.log.info("get Labels");


        await axios({
            method: 'get',
            baseURL: 'https://api.todoist.com',
            url: '/rest/v2/labels',
            responseType: 'json',
            headers:
            { Authorization: 'Bearer ' + APItoken}
        }
        ).then(
            function (response) {
                //adapter.log.info('get labels: ' + stringify(response, null, 2));
                var labels_json = response.data;
                all_label_objekts = labels_json;
            }

        ).catch(

            function (error) {
                if (error.response) {
                    // The request was made and the server responded with a status code
                    adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                    adapter.log.warn(JSON.stringify(error.toJSON()));
                } else if (error.request) {
                    // The request was made but no response was received
                    // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                    // http.ClientRequest in node.js
                   adapter.log.info(error.message);
                } else {
                    // Something happened in setting up the request that triggered an Error
                    adapter.log.error(error.message);
                }
    }.bind(adapter)

    );

    }

    //Sections einlesen:
    if(adapter.config.section === true){

        if(debug) adapter.log.info("get Sections");

    await axios({
        method: 'get',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/sections',
        responseType: 'json',
        headers:
        { Authorization: 'Bearer ' + APItoken}
    }
    ).then(
        function (response) {
            //adapter.log.info('get sections: ' + stringify(response, null, 2));
            var sections_json = response.data;
            all_sections_objects = sections_json;
        }

    ).catch(

        function (error) {
            if (error.response) {
                // The request was made and the server responded with a status code
                adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } else if (error.request) {
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
               adapter.log.info(error.message);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error(error.message);
            }
}.bind(adapter)

);

    }

    //Tasks einlesen:
    //wird immer gemacht
    // wenn das fertig ist, OK ausgeben

        if(debug) adapter.log.info("get Tasks");



    await axios({
        method: 'get',
        baseURL: 'https://api.todoist.com',
        url: '/rest/v2/tasks',
        responseType: 'json',
        headers:
        { Authorization: 'Bearer ' + APItoken}
    }
    ).then(
        function (response) {
            //adapter.log.info('get Tasks: ' + stringify(response, null, 2));
            if(debug)adapter.log.info("response is da");
            var tasks_json = response.data;
            all_task_objekts = tasks_json;
            if(debug)adapter.log.info(JSON.stringify(all_task_objekts));
        }

    ).catch(

        function (error) {
            if (error.response) {
                // The request was made and the server responded with a status code
                adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
                adapter.log.warn(JSON.stringify(error.toJSON()));
            } else if (error.request) {
                // The request was made but no response was received
                // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
                // http.ClientRequest in node.js
               adapter.log.info(error.message);
            } else {
                // Something happened in setting up the request that triggered an Error
                adapter.log.error(error.message);
            }
}.bind(adapter)

);


}



async function getRAW(){

if(adapter.config.project === true){

    //Datenpunkt anlegen

    await adapter.setObjectNotExistsAsync("RAW.Project", {
        type: 'state',
        common: {
            role: 'state',
            name: 'RAW Project Data',
            type: 'json'

        },
        native: {}
          });

    await adapter.setStateAsync("RAW.Project", {val: JSON.stringify(all_project_objekts), ack: true});
}

if(adapter.config.labels === true){

    //Datenpunkt anlegen

    await adapter.setObjectNotExistsAsync("RAW.Labels", {
        type: 'state',
        common: {
            role: 'state',
            name: 'RAW Labels Data',
            type: 'json'

        },
        native: {}
          });

    await adapter.setStateAsync("RAW.Labels", {val: JSON.stringify(all_label_objekts), ack: true});
}

if(adapter.config.section === true){

    //Datenpunkt anlegen

    await adapter.setObjectNotExistsAsync("RAW.Sections", {
        type: 'state',
        common: {
            role: 'state',
            name: 'RAW Sections Data',
            type: 'json'

        },
        native: {}
          });

    await adapter.setStateAsync("RAW.Sections", {val: JSON.stringify(all_sections_objects), ack: true});
}

if(adapter.config.tasks === true){

    //Datenpunkt anlegen

    await adapter.setObjectNotExistsAsync("RAW.Tasks", {
        type: 'state',
        common: {
            role: 'state',
            name: 'RAW Tasks Data',
            type: 'json'

        },
        native: {}
          });

    await adapter.setStateAsync("RAW.Tasks", {val: JSON.stringify(all_task_objekts), ack: true});
}

if(adapter.config.project_collaborators === true){

    //Datenpunkt anlegen

    await adapter.setObjectNotExistsAsync("RAW.Project_Collaborators", {
        type: 'state',
        common: {
            role: 'state',
            name: 'RAW Project Collaborators',
            type: 'json'

        },
        native: {}
          });

    await adapter.setStateAsync("RAW.Project_Collaborators", {val: JSON.stringify(all_collaborators_objects), ack: true});
}



}



async function getProject(){
	if(debug) adapter.log.info("Funktion get Project");
	var ToDoListen = []; // wird mit IDs der TO-DO Listen befuellt
    var Projects_names = []; // wird mit Namen der TO-DO Listen befuellt

    var json_neu = "[]";
    var json_neu_parse = JSON.parse(json_neu);

            var k;
            var projects_json = all_project_objekts; // Alle Projekte in die globelae Variable lesen

            for (k = 0; k < projects_json.length; k++) {
                var projects = parseInt(projects_json[k].id);
                var is_blacklist = false;
                for (var w = 0; w < bl_projects.length; w++){
                    if(projects == bl_projects[w].id){
                      //  adapter.log.info("projects: " + projects);
                      //  adapter.log.info("liste: " +  JSON.stringify(bl_projects[w]));
                        is_blacklist = true;
                      //  adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_projects[w]));
                    }
                }
                if(is_blacklist == true){
                    if(debug) adapter.log.info("überspringen project");
                    continue;
                }
                var projects_name = JSON.stringify(projects_json[k].name);
                projects_name = projects_name.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
                projects_name = projects_name.replace(/\./g, '-'); //entfent die PUnkte hoffentlich...
                //wird für den Return benötigt
                ToDoListen[ToDoListen.length] = projects;
                Projects_names[Projects_names.length] = projects_name;
                /* wird glaub nciht mehr benötigt
                var Listenname = Projects_names[k];
                var listenID = ToDoListen[k];
                */
               var Listenname = projects_name;
                var listenID = projects;

                Listenname = Listenname.replace(/\.|\?|\"|\(|\)|\{|\}|\[|\]|\:|\;|\$|\^|\°|\#|\%|\&|\<|\>|\*|\+|\/|\\/g, '-'); //ERstetzt die Zeichen - aus dem Quellstring weil, sonst sonst probleme

                if(adapter.config.html_objects == true){



                await adapter.setObjectNotExistsAsync("HTML.Projects-HTML." + Listenname, {
                    type: 'state',
                    common: {
                        role: 'html',
                        name: 'ID ' + listenID,
                        type: 'string',

                    },
                    native: {}
              		});
                }
                if(adapter.config.json_objects == true){
              	await adapter.setObjectNotExistsAsync("JSON.Projects-JSON." + Listenname, {
                    type: 'state',
                    common: {
                        role: 'json',
                        name: 'ID ' + listenID,
                        type: 'string',

                    },
                    native: {}
              		});
                }
                if(adapter.config.text_objects == true){
                    await adapter.setObjectNotExistsAsync("TEXT.Projects-TEXT." + Listenname, {
                      type: 'state',
                      common: {
                        role: 'text',
                          name: 'ID ' + listenID,
                          type: 'string',

                      },
                      native: {}
                        });
                  }
            //json_neu[k].Name.push(Listenname);
            // json_neu[k].ID.push(listenID);

            json_neu_parse.push({"name":Listenname, "ID":listenID});

            json_neu = JSON.stringify(json_neu_parse);
            if(debug) adapter.log.info("Aufbau Projekt Liste: " + json_neu);


            }

            if(adapter.config.json_objects == true){
            await adapter.setObjectNotExistsAsync("ALL.JSON-Projects", {
					type: 'state',
                    common: {
                        role: 'json',
                        name: 'JSON Objekt of all Projects',
                        type: 'string',

                    },
                    native: {}
              		});


             await adapter.setStateAsync("ALL.JSON-Projects", {val: json_neu, ack: true});
            }







	return {
		projects_id: ToDoListen,
		projects_names: Projects_names
	};
}


async function getLabels(){

    if(debug) adapter.log.info("Funktion get labels");

	var Labelsid = [];
    var Labels_names = [];

    var json_neu = "[]";
    var json_neu_parse = JSON.parse(json_neu);


            var i;
            var labels_json = all_label_objekts;  //Labels in globale Variable lesen

            for (i = 0; i < labels_json.length; i++) {

                var labels1 = parseInt(labels_json[i].id);

                var is_blacklist = false;
                for (var w = 0; w < bl_labels.length; w++){
                    if(labels1 == bl_labels[w].id){
                      //  adapter.log.info("projects: " + labels1);
                      //  adapter.log.info("liste: " +  JSON.stringify(bl_labels[w]));
                        is_blacklist = true;
                      //  adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_labels[w]));
                    }
                }
                if(is_blacklist == true){
                     if(debug) adapter.log.info("überspringen label");
                    continue;
                }



                var Labels1_names = JSON.stringify(labels_json[i].name);
                Labels1_names = Labels1_names.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
                Labels1_names = Labels1_names.replace(/\./g, '-'); //entfent die PUnkte hoffentlich...
                //für Return
                Labelsid[Labelsid.length] = labels1;
                Labels_names[Labels_names.length] = Labels1_names;
                /*
                var Labels2name = Labels_names[i];
                var Labels2ID = Labelsid[i];
                */
                 if(debug) adapter.log.info("labels anlegen...." + Labels1_names);

                Labels1_names = Labels1_names.replace(/[^a-zA-Z0-9]/g, '-'); //ERstetzt die Zeichen - aus dem Quellstring weil, sonst sonst probleme

                if(adapter.config.html_objects == true){


                await adapter.setObjectNotExistsAsync("HTML.Labels-HTML." + Labels1_names, {
                    type: 'state',
                    common: {
                        role: 'html',
                        name: 'ID ' + labels1,
                        type: 'string',

                    },
                    native: {}
              		});
                }
                if(adapter.config.json_objects == true){
            	await adapter.setObjectNotExistsAsync("JSON.Labels-JSON." + Labels1_names, {
                    type: 'state',
                    common: {
                        role: 'json',
                        name: 'ID ' + labels1,
                        type: 'string',

                    },
                    native: {}
                      });
                }
                if(adapter.config.text_objects == true){
                    await adapter.setObjectNotExistsAsync("TEXT.Labels-TEXT." + Labels1_names, {
                        type: 'state',
                        common: {
                            role: 'text',
                            name: 'ID ' + labels1,
                            type: 'string',

                        },
                        native: {}
                          });
                    }
                      //Baut den Json auf für Json-Labels
                      json_neu_parse.push({"name":Labels1_names, "ID":labels1});

                      json_neu = JSON.stringify(json_neu_parse);
                      if(debug) adapter.log.info("Aufbau Projekt Liste: " + json_neu)

            }

            if(adapter.config.json_objects == true){
            await adapter.setObjectNotExistsAsync("ALL.JSON-Labels", {
					type: 'state',
                    common: {
                        role: 'json',
                        name: 'JSON Objekt of all Labels',
                        type: 'string',

                    },
                    native: {}
              		});


             await adapter.setStateAsync("ALL.JSON-Labels", {val: json_neu, ack: true});
            }


        //jetzt noch die alten Labels löschen, die es nicht mehr gibt:
        /*
        setTimeout(function(){

		adapter.log.warn("löschen alter einträge: ");
		var Key;
        var bestehende_objekte = adapter.getStates('todoist2.' + adapter.instance + '.Labels-JSON.*');
		//bestehende_objekte = bestehende_objekte.replace(/\\/g, ''); //Backschlasche entfernen!

		adapter.log.warn(JSON.stringify(bestehende_objekte));
		bestehende_objekte = bestehende_objekte.replace(/\\/g, ''); //Backschlasche entfernen!
        adapter.log.warn(JSON.stringify(bestehende_objekte));
        */
		/*
		for(Key in bestehende_objekte){
            	//Sliced den Namen des Objektes raus
            	var dd = Key.slice(13,-7);
            	adapter.log.warn("bestehende objekde: " + dd);
            	//Gibt es das bestehende Objekt noch in der Device liste?
            	//var ddd = device.some(function(item){return item.name === dd;});
            	//Wenn es das Objekt nicht mehr gibt dann löschen:
            	//if (ddd === false){await this.delObjectAsync(dd);}

            }
          */
	//	}, 8000);
	return {
		labels_id: Labelsid,
		labes_names: Labels_names
	};

}

async function getSections(){


	if(debug) adapter.log.info("Funktion get Sections");

	var Sectionsid = [];
    var Sections_names = [];

    var json_neu = "[]";
    var json_neu_parse = JSON.parse(json_neu);


            var sections_json = all_sections_objects;
            var i;


            if (sections_json.length > 0){

            for (i = 0; i < sections_json.length; i++) {

                var sections1 = parseInt(sections_json[i].id);

                var is_blacklist = false;
                for (var w = 0; w < bl_sections.length; w++){
                    if(sections1 == bl_sections[w].id){
                       // adapter.log.info("projects: " + sections1);
                       // adapter.log.info("liste: " +  JSON.stringify(bl_sections[w]));
                        is_blacklist = true;
                       // adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_sections[w]));
                    }
                }
                if(is_blacklist == true){
                    if(debug)  adapter.log.info("überspringen section");
                    continue;
                }



                var sections1_names = JSON.stringify(sections_json[i].name);
                sections1_names = sections1_names.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
                Sectionsid[Sectionsid.length] = sections1;
                Sections_names[Sections_names.length] = sections1_names;

                var Sections2name = Sections_names[i];
                var Sections2ID = Sectionsid[i];

                Sections2name = Sections2name.replace(/[^a-zA-Z0-9]/g, ''); //ERstetzt die Zeichen - aus dem Quellstring weil, sonst sonst probleme

                await adapter.setObjectNotExistsAsync("Sections." + Sections2name, {
                    type: 'state',
                    common: {
                        role: 'text',
                        name: 'ID ' + Sections2ID,
                        type: 'string'

                    },
                    native: {}
                      });

                      //Baut den Json auf für Json-Labels
                      json_neu_parse.push({"name":Sections2name, "ID":Sections2ID});

                      json_neu = JSON.stringify(json_neu_parse);
                      if(debug) adapter.log.info("Aufbau Projekt Liste: " + json_neu)

            }

            }else{

        	adapter.log.warn("no Sections found. Please turn it off");
        }

        if(adapter.config.json_objects == true){
        await adapter.setObjectNotExistsAsync("ALL.JSON-Sections", {
					type: 'state',
                    common: {
                        role: 'json',
                        name: 'JSON Objekt of all Sections',
                        type: 'string',

                    },
                    native: {}
              		});


             await adapter.setStateAsync("ALL.JSON-Sections", {val: json_neu, ack: true});
        }


	return {
		sections_id: Sectionsid,
		sections_names: Sections_names
	};

}

async function tasktotask(){

    var i;
    if(debug) adapter.log.info("Funktion task to task");
    //if(debug) adapter.log.warn("anzahl task: " + json.length);
    var json = all_task_objekts;

    var json_neu = "[]";
    var json_neu_parse = JSON.parse(json_neu);

    //Schleife für Objekte unter Tasks:
    for (i = 0; i < json.length; i++) {

        var Liste = parseInt(json[i].project_id);

        var is_blacklist = false;
        for (var w = 0; w < bl_projects.length; w++){
            if(Liste == bl_projects[w].id){
               // adapter.log.info("projects in Tasks: " + Liste);
               // adapter.log.info("liste: " +  JSON.stringify(bl_projects[w]));
                is_blacklist = true;
               // adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_projects[w]));
            }
        }
        if(is_blacklist == true){
             if(debug) adapter.log.info("überspringen task");
            continue;
        }

        if(adapter.config.json_objects === true){
            var prio_neu = 0;
            await helper.reorder_prio(json[i].priority).then(data => { prio_neu = data });
            await json_verarbeitung.table_json(adapter, json[i], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { json_neu_parse.push(data); });

            json_neu = JSON.stringify(json_neu_parse);

            json_neu = json_neu.replace(/\\n/g, '');
            json_neu = json_neu.replace(/\\/g, '');
            json_neu = json_neu.replace(/\""/g, '');

            //json_neu_parse.push({"name":json[i].content, "ID":json[i].project_id});


            if(debug) adapter.log.info("Aufbau Projekt Liste: " + json_neu);
        }

        var content = JSON.stringify(json[i].content);
        var id = JSON.stringify(json[i].id);
        content = content.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
        //content = content[0].toUpperCase() + content.substring(1); // Macht den ersten Buchstaben des strings zu einem Grossbuchstaben
        var taskurl = JSON.stringify(json[i].url);
        taskurl = taskurl.replace(/\"/g, '');



        //Anlage für jeden Task in einen eigenen State:

        var content2 = content.replace(/[^a-zA-Z0-9]/g, '-'); //ERstetzt die Zeichen - aus dem Quellstring weil, sonst sonst probleme

        adapter.setObjectNotExists("Tasks." + content2, {
                type: 'state',
                    common: {
                        name: 'ID ' + id + " Project " + Liste,
                        type: "boolean",
                        role: "button"
                        },
                            native: {}
                          });


    }

// Wenn JSON Objekte angelegt werden sollen denn heir das all JSON Tasks objekten anlegen:

if(adapter.config.json_objects === true){

    await adapter.setObjectNotExistsAsync("ALL.JSON-Tasks", {
        type: 'state',
        common: {
            name: 'JSON Objekt of all Tasks',
            type: 'string',
            role: "json"

        },
        native: {}
          });




 await adapter.setStateAsync("ALL.JSON-Tasks", {val: json_neu, ack: true});
}


}





//zur Verarbeitung von den Objekten in den Projekten und den einzelnen Tasks
async function tasktoproject(project){

    if (debug) adapter.log.info("Funktion task to project");
    if (debug) adapter.log.info("länge: " + project.projects_id.length);

    var j;
    //if(debug) adapter.log.warn("anzahl task: " + json.length);
    var json = all_task_objekts;
    //Verarbeitung von Projekten

    //Schleife zum Befüllen der Projekt Tasks in HTML, Texts und JSON.
    for (j = 0; j < project.projects_id.length; j++) {


        var is_blacklist = false;
        for (var w = 0; w < bl_projects.length; w++) {
            if (project.projects_id[j] == bl_projects[w].id) {
                // adapter.log.info("projects in Tasks: " + project.projects_id[j]);
                // adapter.log.info("liste: " +  JSON.stringify(bl_projects[w]));
                is_blacklist = true;
                // adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_projects[w]));
            }
        }
        if (is_blacklist == true) {
            if (debug) adapter.log.info("überspringen task");
            continue;
        }

        //let HTMLstring = html_verarbeitung.raw_html(adapter);
        var HTMLstring = "";
        if (adapter.config.html_objects == true) {
            await html_verarbeitung.heading_html(adapter).then(data => { HTMLstring = HTMLstring + data });
        }
        //adapter.setState('Lists.' + project.projects_name[j], {ack: true, val: 'empty'});
        var i = 0;

        var json_task = "[]";
        var json_task_parse = JSON.parse(json_task);

        var text_task = "";

        for (i = 0; i < json.length; i++) {

            var Liste = parseInt(json[i].project_id);
            var content = JSON.stringify(json[i].content);

            content = content.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
            //content = content[0].toUpperCase() + content.substring(1); // Macht den ersten Buchstaben des strings zu einem Grossbuchstaben

            //Zuordnung zu den Listen:
            if (Liste === project.projects_id[j]) {
                if (debug) adapter.log.info('[' + content + '] in ' + project.projects_names[j] + ' found');

                //HTML
                if (adapter.config.html_objects == true) {
                    //Fehler in der Priorität anpassen - es kommen die Falschen zahlen umgedreht:
                    var prio_neu = 0;
                    await helper.reorder_prio(json[i].priority).then(data => { prio_neu = data });

                    await html_verarbeitung.table_html(adapter, json[i], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { HTMLstring = HTMLstring + data });



                    //var json_zwischen = JSON.stringify(json[i]);
                    //json_task = json_task + json_zwischen;
                    if (debug) adapter.log.info("Aufbau Projekt Liste HTML: " + HTMLstring);
                }
                //JSON
                if (adapter.config.json_objects == true) {
                    var prio_neu = 0;
                    await helper.reorder_prio(json[i].priority).then(data => { prio_neu = data });
                    await json_verarbeitung.table_json(adapter, json[i], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { json_task_parse.push(data); });
                    if (debug) adapter.log.info("Aufbau Projekt Liste JSON: " + json_task)
                }
                //TEXT
                if (adapter.config.text_objects == true) {
                    text_task = text_task + content + adapter.config.text_separator;
                    if (debug) adapter.log.info("Aufbau Projekt Liste Text: " + text_task);
                }
            }
        }
        if (debug) adapter.log.info("schreibe in liste: " + 'Lists.' + project.projects_names[j]);
        if (debug) adapter.log.info(HTMLstring);

        //json wandeln
        //json_task = JSON.stringify(json_task);

        //Setzte den Status:
        //HTML
        if (adapter.config.html_objects == true) {
            var css = JSON.stringify(adapter.config.html_css_table);
            css = css.replace(/\\n/g, '');
            css = css.replace(/\\/g, '');
            css = css.replace(/\"/g, '');

            var css2 = JSON.stringify(adapter.config.html_css_button);
            css2 = css2.replace(/\\n/g, '');
            css2 = css2.replace(/\\/g, '');
            css2 = css2.replace(/\"/g, '');

            if (json_task === "[]") {
                if (adapter.config.html_visable == false) {
                    HTMLstring = "";
                } else {
                    await html_verarbeitung.table_html_empty(adapter).then(data => { HTMLstring = HTMLstring + data });
                }
            }

            adapter.setState('HTML.Projects-HTML.' + project.projects_names[j], { val: '<style>' + css + css2 + '</style>' + '<script>' + 'function myFunction(id) {servConn.setState("todoist2.0.Control.Close.ID", id)}' + '</script>' + '<table id="task_table">' + HTMLstring + '</table>', ack: true });
        }

        if (adapter.config.json_objects == true) {
            if (json_task === "[]") {
                await json_verarbeitung.table_json_empty(adapter).then(data => { json_task_parse.push(data); });
            }

            json_task = JSON.stringify(json_task_parse);

            json_task = json_task.replace(/\\n/g, '');
            json_task = json_task.replace(/\\/g, '');
            json_task = json_task.replace(/\""/g, '');


            adapter.setState('JSON.Projects-JSON.' + project.projects_names[j], { val: json_task, ack: true });
        }

        if (adapter.config.text_objects == true) {
            if (text_task == "") {
                text_task = adapter.config.text_notodo_name;
            } else {
                text_task = text_task.substr(0, text_task.length - adapter.config.text_separator.length);
            }
            adapter.setState('TEXT.Projects-TEXT.' + project.projects_names[j], { val: text_task, ack: true });
        }

    }// ende der schleife
}

//zur Verarbeitung der Tasks in den Labels:

async function tasktolabels(labels){

    if (debug) adapter.log.info("Funktion task to labels");
    var json = all_task_objekts;
    var j;
    if (debug) adapter.log.info("anzahl task: " + json.length);

    //Verarbeitung von Labels

    for (j = 0; j < labels.labels_id.length; j++) {

        var is_blacklist = false;
        for (var w = 0; w < bl_labels.length; w++) {
            if (labels.labels_id[j] == bl_labels[w].id) {
                //adapter.log.info("projects in Tasks: " + labels.labels_id[j]);
                //adapter.log.info("liste: " +  JSON.stringify(bl_labels[w]));
                is_blacklist = true;
                //adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_labels[w]));
            }
        }
        if (is_blacklist == true) {
            if (debug) adapter.log.info("überspringe task");
            continue;
        }

        var HTMLstring = "";
        //HTML
        if (adapter.config.html_objects == true) {
            await html_verarbeitung.heading_html(adapter).then(data => { HTMLstring = HTMLstring + data });
        }
        //adapter.setState('Lists.' + project.projects_name[j], {ack: true, val: 'empty'});
        var i = 0;
        var json_task = "[]";
        var json_task_parse = JSON.parse(json_task);

        var text_task = "";

        for (i = 0; i < json.length; i++) {

            var content = JSON.stringify(json[i].content);
            var label = []
            label = json[i].labels;



            content = content.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
            //content = content[0].toUpperCase() + content.substring(1); // Macht den ersten Buchstaben des strings zu einem Grossbuchstaben
            if(label.length){
            var d = 0;
            for (d = 0; d < label.length; d++) {

                if (label[d] === labels.labels_id[j]) {
                    if (debug) adapter.log.info('[' + content + '] in ' + labels.labes_names[j] + ' found');
                    //HTML
                    if (adapter.config.html_objects == true) {
                        //Fehler in der Priorität anpassen - es kommen die Falschen zahlen umgedreht:
                        var prio_neu = 0;
                        await helper.reorder_prio(json[i].priority).then(data => { prio_neu = data });
                        await html_verarbeitung.table_html(adapter, json[i], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { HTMLstring = HTMLstring + data });
                    }
                    // JSON
                    if (adapter.config.json_objects) {
                        var prio_neu = 0;
                        await helper.reorder_prio(json[i].priority).then(data => { prio_neu = data });
                        await json_verarbeitung.table_json(adapter, json[i], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { json_task_parse.push(data); });

                        if (debug) adapter.log.info("Aufbau Label Liste: " + json_task)
                    }
                    //TEXT
                    if (adapter.config.text_objects == true) {
                        text_task = text_task + content + adapter.config.text_separator;
                        if (debug) adapter.log.info("Aufbau Projekt Liste Text: " + text_task);
                    }
                }

            }//ende schleife
            }//ende if
        } // ende schleife


        if (debug) adapter.log.info("schreibe in Label: " + 'Label.' + labels.labes_names[j]);
        if (debug) adapter.log.info(HTMLstring);


        //Setzte den Status:
        if (adapter.config.html_objects == true) {
            var css = JSON.stringify(adapter.config.html_css_table);
            css = css.replace(/\\n/g, '');
            css = css.replace(/\\/g, '');
            css = css.replace(/\"/g, '');

            var css2 = JSON.stringify(adapter.config.html_css_button);
            css2 = css2.replace(/\\n/g, '');
            css2 = css2.replace(/\\/g, '');
            css2 = css2.replace(/\"/g, '');

            if (label.length == 0) {
                await html_verarbeitung.table_html_empty(adapter).then(data => { HTMLstring = HTMLstring + data });

                //wenn html tablle bei keinem todo auch nicht angezeigt werden soll:
                if (adapter.config.html_visable == false) {
                    HTMLstring = "";
                }
            }
            adapter.setState('HTML.Labels-HTML.' + labels.labes_names[j], { val: '<style>' + css + css2 + '</style>' + '<script>' + 'function myFunction(id) {servConn.setState("todoist2.0.Control.Close.ID", id)}' + '</script>' + '<table id="task_table">' + HTMLstring + '</table>', ack: true });
        }

        if (adapter.config.json_objects) {

            if (json_task === "[]") {
                await json_verarbeitung.table_json_empty(adapter).then(data => { json_task_parse.push(data); });
            }

            json_task = JSON.stringify(json_task_parse);

            json_task = json_task.replace(/\\n/g, '');
            json_task = json_task.replace(/\\/g, '');
            json_task = json_task.replace(/\""/g, '');

            adapter.setState('JSON.Labels-JSON.' + labels.labes_names[j], { val: json_task, ack: true });
        }


        if (adapter.config.text_objects == true) {
            if (text_task == "") {
                text_task = adapter.config.text_notodo_name;
            } else {
                text_task = text_task.substr(0, text_task.length - adapter.config.text_separator.length);
            }
            adapter.setState('TEXT.Labels-TEXT.' + labels.labes_names[j], { val: text_task, ack: true });
        }

    }//ende schleife

}


async function tasktofilter(filter_json, filter_name){
    return new Promise(async function (resolve, reject) {
    if(debug) adapter.log.info("Funktion task to filter mit name: " + filter_name);
    if(debug) adapter.log.info("länge: " + filter_json.length);
    if(debug) adapter.log.info("daten: "+ JSON.stringify(filter_json));

        var j;
        //if(debug) adapter.log.warn("anzahl task: " + json.length);
        var json = filter_json;

        var json_task = "[]";
        var json_task_parse = JSON.parse(json_task);
        var text_task = "";

        //Verarbeitung von Filter
        var css = JSON.stringify(adapter.config.html_css_table);
        css = css.replace(/\\n/g, '');
        css = css.replace(/\\/g, '');
        css = css.replace(/\"/g, '');

        var css2 = JSON.stringify(adapter.config.html_css_button);
        css2 = css2.replace(/\\n/g, '');
        css2 = css2.replace(/\\/g, '');
        css2 = css2.replace(/\"/g, '');

        var HTMLstring = "";
        await html_verarbeitung.heading_html(adapter).then(data => { HTMLstring = HTMLstring + data });


        //wenn filter leer:
        if(filter_json.length == 0){
            if(adapter.config.html_objects == true){
                await html_verarbeitung.table_html_empty(adapter).then(data => {HTMLstring = HTMLstring + data});

                 //wenn html tablle bei keinem todo auch nicht angezeigt werden soll:
                 if(adapter.config.html_visable == false){
                    HTMLstring = "";
                }
               // adapter.setState('HTML.Filter-HTML.'+filter_name, {val: '<table><ul>' + HTMLstring_filter + '</ul></table>', ack: true});
                adapter.setState('HTML.Filter-HTML.'+filter_name, {val: '<style>' + css + css2 + '</style>' + '<script>' + 'function myFunction(id) {servConn.setState("todoist2.0.Control.Close.ID", id)}' + '</script>' + '<table id="task_table">' + HTMLstring + '</table>', ack: true});
            }

            await json_verarbeitung.table_json_empty(adapter).then(data => {json_task_parse.push(data);});


            if(adapter.config.json_objects == true){
                json_task = json_task.replace(/\\n/g, '');
            json_task = json_task.replace(/\\/g, '');
            json_task = json_task.replace(/\""/g, '');
                adapter.setState('JSON.Filter-JSON.'+filter_name, {val: json_task, ack: true});
            }

            var text_filter = adapter.config.text_notodo_name;

            if(adapter.config.text_objects == true){
                adapter.setState('TEXT.Filter-TEXT.'+filter_name, {val: text_filter, ack: true});
            }
        }


        //Schleife zum Befüllen der Filter Tasks in HTML, Texts und JSON.
        for (j = 0; j < filter_json.length; j++) {


            var is_blacklist = false;
            for (var w = 0; w < bl_projects.length; w++){
                if(filter_json[j].projects_id == bl_projects[w].id){
                   // adapter.log.info("projects in Tasks: " + project.projects_id[j]);
                   // adapter.log.info("liste: " +  JSON.stringify(bl_projects[w]));
                    is_blacklist = true;
                   // adapter.log.warn("Blacklist erkannt: " + JSON.stringify(bl_projects[w]));
                }
            }
            if(is_blacklist == true){
                if(debug) adapter.log.info("überspringen task");
                continue;
            }


            //Zuordnung zu den Listen:

            //HTML

            //Fehler in der Priorität anpassen - es kommen die Falschen zahlen umgedreht:
            var prio_neu = 0;
            await helper.reorder_prio(json[j].priority).then(data => { prio_neu = data });

            await html_verarbeitung.table_html(adapter, json[j], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { HTMLstring = HTMLstring + data });

            //var json_zwischen = JSON.stringify(json[i]);
            //json_task = json_task + json_zwischen;
            if (debug) adapter.log.info("Aufbau Filter Liste HTML: " + HTMLstring);

            //JSON
            await json_verarbeitung.table_json(adapter, json[j], prio_neu, all_project_objekts, all_label_objekts, all_sections_objects, all_collaborators_objects).then(data => { json_task_parse.push(data); });
            if (debug) adapter.log.info("Aufbau Filter Liste JSON: " + json_task_parse)

            //TEXT
            var content = JSON.stringify(json[j].content);
            content = content.replace(/\"/g, ''); //entfernt die Anfuehrungszeichen aus dem Quellstring
            //content = content[0].toUpperCase() + content.substring(1); // Macht den ersten Buchstaben des strings zu einem Grossbuchstaben

            text_task = text_task + content + adapter.config.text_separator;
            if (debug) adapter.log.info("Aufbau Filter Liste Text: " + text_task);


            if(debug) adapter.log.info("schreibe in filterliste: " +filter_name);
            if(debug) adapter.log.info(HTMLstring);

            //json wandeln
                //json_task = JSON.stringify(json_task);



        }//ende schleife

        //Setzte den Status:
        if(adapter.config.html_objects == true){
            adapter.setState('HTML.Filter-HTML.'+filter_name, {val: '<style>' + css + css2 + '</style>' + '<script>' + 'function myFunction(id) {servConn.setState("todoist2.0.Control.Close.ID", id)}' + '</script>' + '<table id="task_table">' + HTMLstring + '</table>', ack: true});
        }
        if(adapter.config.json_objects == true){


            json_task = JSON.stringify(json_task_parse);
            json_task = json_task.replace(/\\n/g, '');
            json_task = json_task.replace(/\\/g, '');
            json_task = json_task.replace(/\""/g, '');


            adapter.setState('JSON.Filter-JSON.'+filter_name, {val: json_task, ack: true});
        }

        if(adapter.config.text_objects == true){
            if(text_task == ""){
                text_task = adapter.config.text_notodo_name;
            }else{
                text_task = text_task.substr(0, text_task.length-adapter.config.text_separator.length);
            }
            adapter.setState('TEXT.Filter-TEXT.'+filter_name, {val: text_task, ack: true});
        }

        resolve("ok");

});
}




async function remove_old_objects(){
    if(debug) adapter.log.info("Funktion remove old objects");
var new_id;
var pos;
var end_pos;
var match = false;
// Tasks:
if (adapter.config.tasks == true){
    adapter.getStates('Tasks.*', function (err, states) {
       if (debug) adapter.log.info("...........Jetzt Tasks prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {
            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);



            for(var i = 0; i < all_task_objekts.length; i++){

                //Prüfen ob etwas auf der Blacklist steht.
                var bearbeitet13 = all_task_objekts[i].project_id;
                var is_blacklist = false;
                for (var w = 0; w < bl_projects.length; w++){

                    if(bearbeitet13 == bl_projects[w]){
                        is_blacklist = true;
                    }
                }
                if(is_blacklist == true){
                    continue;
                }



                //adapter.log.error("nummer: " + i + "content: " + all_task_objekts[i].content);
                //adapter.log.info("überprüfung: " +  all_task_objekts[i].content + " mit " + new_id);
                var bearbeitet12 = all_task_objekts[i].content.replace(/[^a-zA-Z0-9]/g, '-'); // Punkte entfernden und mit - erseztten


                //Prüfen ob etwas von der API gelöscht wurde
                if (bearbeitet12 == new_id) {
                    //adapter.log.warn("länge: " + all_task_objekts.length);
                    //adapter.log.info("länge objekte  " + states.length);
                    //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                    match = true;

                }




            }

            if (match != true){

                adapter.log.info("dieser state löschen: " + new_id);
                adapter.delObject("Tasks." + new_id, function (err) {

                               if (err) adapter.log.error('Cannot delete object: ' + err);

                           });

            }

        match = false;
        }
    });
}


 //Projekte HTML
if (adapter.config.project == true && adapter.config.html_objects == true){
    adapter.getStates('HTML.Projects-HTML.*', function (err, states) {
      if (debug)  adapter.log.info("...........Jetzt Projekte HTML prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);
            for(var i = 0; i < all_project_objekts.length; i++){

                //Prüfen ob etwas auf der Blacklist steht.
                var bearbeitet12 = all_project_objekts[i].name; // .replace(/[^a-zA-Z0-9]/g, '-')Punkte entfernden und mit - erseztten

                var bearbeitet13 = all_project_objekts[i].id;

                var is_blacklist = false;
                for (var w = 0; w < bl_projects.length; w++){

                    if(bearbeitet13 == bl_projects[w].id){
                        if (bearbeitet12 == new_id) {
                        //adapter.log.warn("id: " + bearbeitet13);
                        is_blacklist = true;
                        }
                    }
                }
                if(is_blacklist == true){
                    continue;
                }



                 if (bearbeitet12 == new_id) {
                    // adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                    // adapter.log.info("länge objekte Projekte  " + states.length);
                    // adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                     match = true;

                 }
             }

             if (match != true){

                 adapter.log.info("dieser state löschen: " + new_id);
                 adapter.delObject("HTML.Projects-HTML." + new_id, function (err) {

                                 if (err) adapter.log.error('Cannot delete object: ' + err);

                             });

             }

         match = false;

        }
    })
}
    //Projekte JSON
    if (adapter.config.project == true && adapter.config.json_objects == true){
    adapter.getStates('JSON.Projects-JSON.*', function (err, states) {
       if (debug) adapter.log.info("...........Jetzt Projekte JSON prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);
            for(var i = 0; i < all_project_objekts.length; i++){


                 //Prüfen ob etwas auf der Blacklist steht.
                 var bearbeitet12 = all_project_objekts[i].name; // .replace(/[^a-zA-Z0-9]/g, '-') Punkte entfernden und mit - erseztten


                 var bearbeitet13 = all_project_objekts[i].id;
                 var is_blacklist = false;
                 for (var w = 0; w < bl_projects.length; w++){

                     if(bearbeitet13 == bl_projects[w].id){
                        if (bearbeitet12 == new_id) {
                        is_blacklist = true;
                        }
                     }
                 }
                 if(is_blacklist == true){
                     continue;
                 }



                 if (bearbeitet12 == new_id) {
                     //adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                     //adapter.log.info("länge objekte Projekte  " + states.length);
                     //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                     match = true;

                 }
             }

             if (match != true){

                 adapter.log.info("dieser state löschen: " + new_id);
                 adapter.delObject("JSON.Projects-JSON." + new_id, function (err) {

                                 if (err) adapter.log.error('Cannot delete object: ' + err);

                             });

             }

         match = false;

        }
    })
}

//Projekte TEXT
if (adapter.config.project == true && adapter.config.text_objects == true){
    adapter.getStates('TEXT.Projects-TEXT.*', function (err, states) {
       if (debug) adapter.log.info("...........Jetzt Projekte TEXT prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);
            for(var i = 0; i < all_project_objekts.length; i++){


                 //Prüfen ob etwas auf der Blacklist steht.
                 var bearbeitet12 = all_project_objekts[i].name; // Punkte entfernden und mit - erseztten .replace(/[^a-zA-Z0-9]/g, '-')

                 var bearbeitet13 = all_project_objekts[i].id;
                 var is_blacklist = false;
                 for (var w = 0; w < bl_projects.length; w++){

                     if(bearbeitet13 == bl_projects[w].id){
                        if (bearbeitet12 == new_id) {
                        is_blacklist = true;
                        }
                     }
                 }
                 if(is_blacklist == true){
                     continue;
                 }
                //adapter.log.info("liste aller dinge " + bearbeitet12);
                //adapter.log.info("zu prüfendes ding " + new_id);


                 if (bearbeitet12 == new_id) {
                     //adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                     //adapter.log.info("länge objekte Projekte  " + states.length);
                     //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                     match = true;

                 }
             }

             if (match != true){

                 adapter.log.info("Projekte Text dieser state löschen: " + new_id);
                 adapter.delObject("TEXT.Projects-TEXT." + new_id, function (err) {

                                 if (err) adapter.log.error('Cannot delete object: ' + err);

                             });

             }

         match = false;

        }
    })
}






//Labels HTML
if (adapter.config.labels == true && adapter.config.html_objects == true){
adapter.getStates('HTML.Labels-HTML.*', function (err, states) {
    if (debug) adapter.log.info("...........Jetzt Labels HTML prüfen ob etwas gelöscht werden soll..............");
    for (var id in states) {

        //Aus der ID den Namen extrahieren:
        pos = id.lastIndexOf('.');
        pos = pos +1;
        end_pos = id.length;
        new_id = id.substr(pos, end_pos);

        for(var i = 0; i < all_label_objekts.length; i++){

            //Prüfen ob etwas auf der Blacklist steht.
            var bearbeitet13 = all_label_objekts[i].id;
            var bearbeitet12 = all_label_objekts[i].name; //  .replace(/[^a-zA-Z0-9]/g, '-')Punkte entfernden und mit - erseztten

            var is_blacklist = false;
            //adapter.log.warn("länge bl_labels " + bl_labels.length);
            for (var w = 0; w < bl_labels.length; w++){
             //adapter.log.info("ich bin in der schleife");
             //adapter.log.info("bl label id" + bl_labels[w].id);
             //adapter.log.info("bearbeitet " + bearbeitet13);
                if(bearbeitet13 == bl_labels[w].id){
                    if(bearbeitet12 == new_id){

                    is_blacklist = true;

                    }
                    }

            }
            if(is_blacklist == true){
                continue;
                }





             if (bearbeitet12 == new_id) {
                 //adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                 //adapter.log.info("länge objekte Projekte  " + states.length);
                 //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                 match = true;

             }
         }
        // adapter.log.warn("vor löschung " + new_id + " match " + match);
         if (match != true){

             adapter.log.info("labels html dieser state löschen: " + new_id);
             adapter.delObject("HTML.Labels-HTML." + new_id, function (err) {

                             if (err) adapter.log.error('Cannot delete object: ' + err);

                         });

         }

     match = false;

    }
})
}
//Labels JSON
if (adapter.config.labels == true && adapter.config.json_objects == true){
adapter.getStates('JSON.Labels-JSON.*', function (err, states) {
    if(debug) adapter.log.info("...........Jetzt Labels JSON prüfen ob etwas gelöscht werden soll..............");
    for (var id in states) {

        //Aus der ID den Namen extrahieren:
        pos = id.lastIndexOf('.');
        pos = pos +1;
        end_pos = id.length;
        new_id = id.substr(pos, end_pos);



        for(var i = 0; i < all_label_objekts.length; i++){

            var bearbeitet12 = all_label_objekts[i].name; //.replace(/[^a-zA-Z0-9]/g, '-') Punkte entfernden und mit - erseztten
            var bearbeitet13 = all_label_objekts[i].id;
            var is_blacklist = false;
            for (var w = 0; w < bl_labels.length; w++){

                if(bearbeitet13 == bl_labels[w].id){
                    if (bearbeitet12 == new_id) {
                    is_blacklist = true;
                    }
                }
            }
            if(is_blacklist == true){
                continue;
            }



             if (bearbeitet12 == new_id) {
                // adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                 //adapter.log.info("länge objekte Projekte  " + states.length);
                 //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                 match = true;

             }
         }

         if (match != true){

             adapter.log.info("json html dieser state löschen: " + new_id);
             adapter.delObject("JSON.Labels-JSON." + new_id, function (err) {

                             if (err) adapter.log.error('Cannot delete object: ' + err);

                         });

         }

     match = false;

    }
})
}

//Labels TEXT
if (adapter.config.labels == true && adapter.config.text_objects == true){
    adapter.getStates('TEXT.Labels-TEXT.*', function (err, states) {
        if(debug) adapter.log.info("...........Jetzt Labels Text prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);



            for(var i = 0; i < all_label_objekts.length; i++){

                var bearbeitet12 = all_label_objekts[i].name; //.replace(/[^a-zA-Z0-9]/g, '-') Punkte entfernden und mit - erseztten
                var bearbeitet13 = all_label_objekts[i].id;
                var is_blacklist = false;
                for (var w = 0; w < bl_labels.length; w++){

                    if(bearbeitet13 == bl_labels[w].id){
                        if (bearbeitet12 == new_id) {
                        is_blacklist = true;
                        }
                    }
                }
                if(is_blacklist == true){
                    continue;
                }



                 if (bearbeitet12 == new_id) {
                    // adapter.log.warn("länge Projekte: " + all_project_objekts.length);
                     //adapter.log.info("länge objekte Projekte  " + states.length);
                     //adapter.log.info("NUM: " + i + " gefunden: " + new_id);
                     match = true;

                 }
             }

             if (match != true){

                 adapter.log.info("Text Labels dieser state löschen: " + new_id);
                 adapter.delObject("TEXT.Labels-TEXT." + new_id, function (err) {

                                 if (err) adapter.log.error('Cannot delete object: ' + err);

                             });

             }

         match = false;

        }
    })
    }


// Filter HTML
if(adapter.config.html_objects == true){
    adapter.getStates('HTML.Filter-HTML.*', function (err, states) {
        if(debug) adapter.log.info("...........Jetzt Filter HTML prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);

            for(var i = 0; i < filter_list.length; i++){

                if(filter_list[i].filterlist_filter_name == new_id && filter_list[i].filterlist_aktiv == true){

                    match = true;
                }

            }

            if (match != true){

                adapter.log.info("Filter Html löschen: " + new_id);
                adapter.delObject("HTML.Filter-HTML." + new_id, function (err) {

                                if (err) adapter.log.error('Cannot delete object: ' + err);

                            });

            }

        match = false;

        }



    });

}

// Filter JSON
if(adapter.config.html_objects == true){
    adapter.getStates('JSON.Filter-JSON.*', function (err, states) {
        if(debug) adapter.log.info("...........Jetzt Filter JSON prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);

            for(var i = 0; i < filter_list.length; i++){

                if(filter_list[i].filterlist_filter_name == new_id && filter_list[i].filterlist_aktiv == true){

                    match = true;
                }

            }

            if (match != true){

                adapter.log.info("Filter JSON löschen: " + new_id);
                adapter.delObject("JSON.Filter-JSON." + new_id, function (err) {

                                if (err) adapter.log.error('Cannot delete object: ' + err);

                            });

            }

        match = false;

        }



    });

}

// Filter TEXT
if(adapter.config.html_objects == true){
    adapter.getStates('TEXT.Filter-TEXT.*', function (err, states) {
        if(debug) adapter.log.info("...........Jetzt Filter TEXT prüfen ob etwas gelöscht werden soll..............");
        for (var id in states) {

            //Aus der ID den Namen extrahieren:
            pos = id.lastIndexOf('.');
            pos = pos +1;
            end_pos = id.length;
            new_id = id.substr(pos, end_pos);

            for(var i = 0; i < filter_list.length; i++){

                if(filter_list[i].filterlist_filter_name == new_id && filter_list[i].filterlist_aktiv == true){

                    match = true;
                }

            }

            if (match != true){

                adapter.log.info("Filter TEXT löschen: " + new_id);
                adapter.delObject("TEXT.Filter-TEXT." + new_id, function (err) {

                                if (err) adapter.log.error('Cannot delete object: ' + err);

                            });

            }

        match = false;

        }



    });

}


}



async function filterlist(){
    if(debug)  adapter.log.info("Starte filterliste");
    for (var i = 0; i < filter_list.length; i++) {

    var filter_aktiv = filter_list[i].filterlist_aktiv;
    var filter_name = filter_list[i].filterlist_filter_name;
    var filter_query = filter_list[i].filterlist_query;

    //url muss encoded werden, damit die zeichen wie # oder leerzeichen korrekt an die api gesendet werden
    filter_query = encodeURIComponent(filter_query);

    if(filter_aktiv != true){
        continue;
    }

    //adapter.log.info(filter_aktiv);
    if(debug) adapter.log.info("name: " +filter_name);
    if(debug) adapter.log.info("querry: " + filter_query);

    filter_name = filter_name.replace(/[^a-zA-Z0-9]/g, '-'); //ERstetzt die Zeichen - aus dem Quellstring weil, sonst sonst probleme

    if(adapter.config.html_objects == true){

    await adapter.setObjectNotExistsAsync("HTML.Filter-HTML." + filter_name, {
        type: 'state',
        common: {
            role: 'html',
            name: 'Query ' + filter_query,
            type: 'string',

        },
        native: {}
          });
    }
    if(adapter.config.json_objects == true){
      await adapter.setObjectNotExistsAsync("JSON.Filter-JSON." + filter_name, {
        type: 'state',
        common: {
            role: 'json',
            name: 'Query ' + filter_query,
            type: 'string',

        },
        native: {}
          });
    }
    if(adapter.config.text_objects == true){
        await adapter.setObjectNotExistsAsync("TEXT.Filter-TEXT." + filter_name, {
          type: 'state',
          common: {
            role: 'text',
              name: 'Query ' + filter_query,
              type: 'string',

          },
          native: {}
            });
    }

    //frage die daten an:
    var antwort = await getDate_filter(filter_query);

    if(debug) adapter.log.info(JSON.stringify(filter_name));

    //füllte die states mit den jeweiligen daten:
    var status = await tasktofilter(all_filter_objects, filter_name);
    if(debug)  adapter.log.info("Status filter: " + status);

    }

}


async function getDate_filter(filter_query){

	var APItoken = adapter.config.token;

await axios({
    method: 'get',
    baseURL: 'https://api.todoist.com',
    url: '/rest/v2/tasks?filter=' + filter_query,
    responseType: 'json',
    headers:
    { Authorization: 'Bearer ' + APItoken}
}
).then(
    function (response) {
        if(debug)adapter.log.info('hole  Filter: ' + response);
        if(typeof response === 'object' && response.status == 402){
            adapter.log.warn("Todoist Api say you don't have a premium account. Pleasy bye one or deaktivate this feature!")
        }else{
        var filter_json = response.data;

         all_filter_objects = filter_json;

        }
    }

).catch(

    function (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            adapter.log.warn('received error ' + error.response.status + ' response from todoist with content: ' + JSON.stringify(error.response.data));
            adapter.log.warn(JSON.stringify(error.toJSON()));
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
           adapter.log.info(error.message);
        } else {
            // Something happened in setting up the request that triggered an Error
            adapter.log.error(error.message);
        }
}.bind(adapter)

);
}


async function main() {
    if (!adapter.config.token) {
        adapter.log.warn('Token todoist is not set!');
        return;
    }


    // Check Verbindung
    // wenn false, dann beenden.
    // es erfolgt dann auch kein neuer check mehr, adapter muss dann wohl erst neu gestatet werden??
   var status = await check_online();



       if (online_net == false){
        /*
        rechnen = rechnen * 2;
        clearTimeout(mainintval);
        mainintval = setTimeout(function(){
            main();
        }, rechnen);
        */
        online_count ++;
        if(online_count > 10){
            clearInterval(mainintval);
            adapter.log.error("Adapter cant't finde the API. You need to restart the Adapter to try again!!!!")   ;
        }
        adapter.log.warn("Check again in " + poll + " seconds!");
        var x = 10 - online_count;
        adapter.log.warn("Checks before you need to restatd the Adapter: " + x);
        return

    };

    //ist online, deshalb count auf 0 stellen:
    if(online_count > 0){
        online_count = 0;
        adapter.log.info("Adapter is online, Checks before restart reset!");

    }



    poll = adapter.config.pollingInterval;

    if (debug) adapter.log.warn("Debug Mode for todoist is online: Many Logs are generated!");
    //if (debug) adapter.log.info("Token: " + adapter.config.token);
	if (debug) adapter.log.info("Polling: " + adapter.config.pollingInterval);
    if (debug) adapter.log.info("Debug mode: " + adapter.config.debug);
    if (debug) adapter.log.warn("Dublikate Modus: " + adapter.config.dublicate);

    // lese die daten ein:
    status = await getData();

    // wenn daten da sind weiter:
    if(adapter.config.raw_data === true){
        var raw_data =  await getRAW();

    }


        if(adapter.config.project === true){
            var projects =  await getProject();
            if (typeof projects !== "undefined") {
            tasktoproject(projects);
            }
        }

        if(adapter.config.section === true){
            var sections =  await getSections();

        }

        if(adapter.config.labels === true){
            var labels =  await getLabels();
            if (typeof labels !== "undefined") {
            tasktolabels(labels);
            }
        }

        if(adapter.config.tasks === true){

            tasktotask();

        }


        syncronisation();


    if (adapter.config.rm_old_objects == true){

        remove_old_objects();

    }

    if (adapter.config.filter_aktiv == true){

        filterlist();

    }




//wenn fertig  funktion nach ablauf poll neu starten:
//mainintval =  (function(){main();}, 60000);
//adapter.log.info("main: " + poll);
/*
clearTimeout(mainintval);
mainintval = setTimeout(function(){
    main();
}, poll);
*/
}

// If started as allInOne/compact mode => return function to create instance

// @ts-ignore
if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}

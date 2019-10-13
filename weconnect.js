/*

Usage example:

    weconnect = require('./weconnect');

    await weconnect.login(CARNET_USERNAME, CARNET_PASSWORD).catch(err => {
        console.log("Exception: ", err);
    });
    
    let res = await weconnect.api('/-/vehicle-info/get-vehicle-details');
    console.log('API res = ', res);

Alternative:

    weconnect = require('./weconnect');

    weconnect.login(CARNET_USERNAME, CARNET_PASSWORD)
    .then(api => {
        api('/-/vehicle-info/get-vehicle-details')
        .then(res => {
            console.log('API res = ', res);
        })
    })

Known functions:
    '/-/msgc/get-new-messages'
    '/-/vsr/request-vsr'
    '/-/vsr/get-vsr'
    '/-/cf/get-location'
    '/-/vehicle-info/get-vehicle-details'
    '/-/emanager/get-emanager'

*/

const RP = require('request-promise');

let auth_headers = {};

let headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
}

const AUTH_BASE_URL = "https://identity.vwgroup.io";
const BASE_URL = "https://www.portal.volkswagen-we.com";
const LANDING_PAGE_URL = BASE_URL + '/portal/en_GB/web/guest/home';
const GET_LOGIN_URL = BASE_URL + '/portal/en_GB/web/guest/home/-/csrftokenhandling/get-login-url';
const COMPLETE_LOGIN_URL = BASE_URL + "/portal/web/guest/complete-login";

const csrf_re = new RegExp('<meta name="_csrf" content="([^"]*)"/>');
const login_action_url_re = new RegExp('<formclass="content"id="emailPasswordForm"name="emailPasswordForm"method="POST"novalidate*.*action="([^"]*)">');
const login_action_url2_re = new RegExp('<formclass="content"id="credentialsForm"name="credentialsForm"method="POST"action="([^"]*)">');
const login_relay_state_token_re = new RegExp('<inputtype="hidden"id="input_relayState"name="relayState"value="([^"]*)"/>');
const login_csrf_re = new RegExp('<inputtype="hidden"id="csrf"name="_csrf"value="([^"]*)"/>');
const login_hmac_re = new RegExp('<inputtype="hidden"id="hmac"name="hmac"value="([^"]*)"/>');
const authcode_re = new RegExp('&code=([^"]*)');

let apiUrl = '';

extract_csrf = function (r) {
    return r.match(csrf_re)[1];
}

extract_login_action_url = function (r) {
    const loginhtml = r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
    return loginhtml.match(login_action_url_re)[1];
}

extract_login_action2_url = function (r) {
    const loginhtml = r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
    return loginhtml.match(login_action_url2_re)[1];
}

extract_login_relay_state_token = function (r) {
    const loginhtml = r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
    return loginhtml.match(login_relay_state_token_re)[1];
}

extract_login_hmac = function (r) {
    const loginhtml = r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
    return loginhtml.match(login_hmac_re)[1];
}

extract_login_csrf = function (r) {
    const loginhtml = r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
    return loginhtml.match(login_csrf_re)[1];
}

extract_code = function (r) {
    return r.match(authcode_re)[1];
}

build_complete_login_url = function (state) {
    return COMPLETE_LOGIN_URL + '?p_auth=' + state + '&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus';
}

remove_whitespace = function (r) {
    return r.replace(/\n/g, '').replace(/\r/g, '').replace(/ /g, '');
}

function JSON_to_URLEncoded(element, key, list) {
    var list = list || [];
    if (typeof (element) == 'object') {
        for (var idx in element)
            JSON_to_URLEncoded(element[idx], key ? key + '[' + idx + ']' : idx, list);
    } else {
        list.push(key + '=' + encodeURIComponent(element));
    }
    return list.join('&');
}

function catchRedirect(uri, headers, body, method) {
    return new Promise((resolve, reject) => {
        rp({
            headers: headers,
            uri: uri,
            body: body,
            method: method,
            resolveWithFullResponse: true,
            followRedirect: false,
        })
            .then(res => {
                reject('Failed to log in to We Connect');
            })
            .catch(err => {
                resolve(err.response.headers.location);
            })
    });
}

let savedEmail = '';
let savedPassword = '';

let rp = null;
let cookieJar = null;

function callLandingPage(landing_page_url) {
    // Call landing page and return csrf
    return new Promise((resolve, reject) => {
        rp({
            uri: landing_page_url,
            resolveWithFullResponse: true,
            method: 'GET',
        })
            .then(res => {
                csrf = extract_csrf(res.body);
                resolve(csrf);
            })
            .catch(err => {
                reject(err);
            });
    });
}

function getLoginUrl(base_url, csrf, get_login_url) {
    return new Promise((resolve, reject) => {
        auth_headers["Referer"] = base_url + '/portal';
        auth_headers["X-CSRF-Token"] = csrf;
        rp({
            headers: auth_headers,
            uri: get_login_url,
            resolveWithFullResponse: true,
            followAllRedirects: true,
            method: 'POST',
        })
            .then(res => {
                resolve(JSON.parse(res.body).loginURL["path"]);
            })
            .catch(err => {
                reject(err);
            });
    });
}

function getLoginActionUrl(login_form_url) {
    return rp({
        headers: auth_headers,
        uri: login_form_url,
        resolveWithFullResponse: true,
        followAllRedirects: true,
        method: 'GET',
    });
}

function sendLoginUserName(email, login_relay_state_token, login_csrf, hmac_token, login_form_url, login_action_url) {
    let data = {
        'email': email,
        'relayState': login_relay_state_token,
        '_csrf': login_csrf,
        'hmac': hmac_token
    };
    let form = JSON_to_URLEncoded(data);
    auth_headers['Content-Length'] = form.length;
    auth_headers["Referer"] = login_form_url;
    auth_headers["Content-Type"] = "application/x-www-form-urlencoded";
    delete auth_headers["X-CSRF-Token"];
    return rp({
        headers: auth_headers,
        uri: login_action_url,
        form: form,
        method: 'POST',
        resolveWithFullResponse: true,
        followAllRedirects: true,
    });
}

function sendLoginPasssword(email, login_action_url_response_data, password, login_action_url, login_action2_url) {
    // Send login password and get action url
    const login_relay_state_token2 = extract_login_relay_state_token(login_action_url_response_data);
    const hmac_token2 = extract_login_hmac(login_action_url_response_data);
    const login_csrf2 = extract_login_csrf(login_action_url_response_data);
    data = {
        'email': email,
        'relayState': login_relay_state_token2,
        '_csrf': login_csrf2,
        'hmac': hmac_token2,
        'password': password
    };
    form = JSON_to_URLEncoded(data);
    contentLength = form.length;
    auth_headers['Content-Length'] = contentLength;
    auth_headers["Referer"] = login_action_url;
    return rp({
        headers: auth_headers,
        uri: login_action2_url,
        form: form,
        method: 'POST',
        resolveWithFullResponse: true,
        followAllRedirects: true,
    });
}

function getFinalState(api_url) {
    // Complete login and get final state
    return rp({
        headers: auth_headers,
        uri: api_url,
        resolveWithFullResponse: true,
        followAllRedirects: true,
        method: 'GET',
    });
}

exports.login = function (email, password) {

    return new Promise((resolve, reject) => {

        savedEmail = email;
        savedPassword = password;

        cookieJar = RP.jar();
        rp = RP.defaults({ jar: cookieJar });

        let login_form_url = '';
        let login_action_url = '';
        let login_action2_url = '';

        auth_headers = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
        };

        callLandingPage(LANDING_PAGE_URL)
            .then(res => {
                const csrf = res;
                // console.log('Calling getLoginUrl');
                return (getLoginUrl(BASE_URL, csrf, GET_LOGIN_URL));
            })
            .then(res => {
                const login_url = res;
                // console.log('Calling catchRedirect');
                return catchRedirect(login_url, auth_headers, '', 'GET');
            })
            .then(res => {
                const login_form_url = res;
                // console.log('Calling getLoginActionUrl');
                return getLoginActionUrl(login_form_url);
            })
            .then(res => {
                login_action_url = AUTH_BASE_URL + extract_login_action_url(res.body);
                const login_relay_state_token = extract_login_relay_state_token(res.body);
                const hmac_token = extract_login_hmac(res.body);
                const login_csrf = extract_login_csrf(res.body);
                // console.log('Calling sendLoginUserName');
                return sendLoginUserName(email, login_relay_state_token, login_csrf, hmac_token, login_form_url, login_action_url);
            })
            .then(res => {
                const login_action_url_response_data = remove_whitespace(res.body);
                try {
                    login_action2_url = AUTH_BASE_URL + extract_login_action2_url(login_action_url_response_data);
                } catch (e) {
                    reject('weconnect: Failed to log in. Wrong user: ' + email);
                    return;
                }
                // console.log('Calling sendLoginPasssword');
                return sendLoginPasssword(email, login_action_url_response_data, password, login_action_url, login_action2_url);
            })
            .then(res => {
                // Get base url
                let portlet_code = '';
                try {
                    portlet_code = extract_code(res.request.path);
                } catch (e) {
                    reject('weconnect: Failed to log in. Wrong password. ' + e);
                    return;
                }
                auth_headers["Referer"] = login_action2_url
                const csrf = extract_csrf(res.body);
                const complete_login_url = build_complete_login_url(csrf);
                const data = {
                    '_33_WAR_cored5portlet_code': portlet_code
                };
                const form = JSON_to_URLEncoded(data);
                const contentLength = form.length;
                auth_headers['Content-Length'] = contentLength;
                return catchRedirect(complete_login_url, auth_headers, form, 'POST');
            })
            .then(res => {
                if (!res) {
                    reject('weconnect: Failed to login (get base url).');
                    return;
                }
                apiUrl = res; // Set global API url
                delete auth_headers["Content-Length"];
                // console.log('Calling getFinalState');
                return getFinalState(apiUrl);
            })
            .then(res => {
                const csrf = extract_csrf(res.body);
                headers["Referer"] = apiUrl;
                headers["X-CSRF-Token"] = csrf;
                // console.log('resolving');
                resolve(this.api);
            })
            .catch(err => {
                // console.log('rejecting');
                reject(err);
            });
    });
}

tryApi = function (uri) {
    return new Promise((resolve, reject) => {

        if (!apiUrl) {
            reject('weconnect error: You must successfully call login before doing api calls.');
            return;
        }

        rp({
            headers: headers,
            uri: apiUrl + uri,
            method: 'POST',
            resolveWithFullResponse: true,
            followAllRedirects: true,
        })
            .then(res => {
                response = res;
                resolve(response);
            })
            .catch(err => {
                response = {
                    statusCode: 0,
                    body: err.message
                }
                resolve(response);
            });

    });
}

exports.api = function (uri, secondTime = false) {
    return new Promise((resolve, reject) => {
        tryApi(uri)
            .then(response => {
                if (response.body == '{"errorCode":"2"}') {
                    if (secondTime) {
                        const msg = 'Second login attempt. Failing.';
                        console.log(msg);
                        reject(msg);
                        return;
                    }
                    console.log('weconnect token expired. Logging in again.');
                    this.login(savedEmail, savedPassword)
                        .then(api => {
                            resolve(api(uri, true));
                            return;
                        })
                        .catch(err => {
                            reject(err);
                            return;
                        });
                }
                resolve(response.body);
            })
            .catch(err => {
                reject(err);
            });
    });
}


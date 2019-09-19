/*

Usage example:

    weconnect = require('./weconnect');

    await weconnect.login(CARNET_USERNAME, CARNET_PASSWORD).catch(err => {
        console.log("Exception: ", err);
    });
    
    let res = await weconnect.api('/-/vehicle-info/get-vehicle-details');
    console.log('API res = ', res);

    Known functions:
	    '/-/msgc/get-new-messages'
	    '/-/vsr/request-vsr'
	    '/-/vsr/get-vsr'
	    '/-/cf/get-location'
	    '/-/vehicle-info/get-vehicle-details'
	    '/-/emanager/get-emanager'

*/

const RP = require('request-promise')

let auth_headers = {};

let headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json;charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
}

const auth_base_url = "https://identity.vwgroup.io";
const base_url = "https://www.portal.volkswagen-we.com";
const landing_page_url = base_url + '/portal/en_GB/web/guest/home';
const get_login_url = base_url + '/portal/en_GB/web/guest/home/-/csrftokenhandling/get-login-url';
const complete_login_url = base_url + "/portal/web/guest/complete-login";

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
    return complete_login_url + '?p_auth=' + state + '&p_p_id=33_WAR_cored5portlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&p_p_col_id=column-1&p_p_col_count=1&_33_WAR_cored5portlet_javax.portlet.action=getLoginStatus';
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

async function catchRedirect(uri, headers, body, method) {
    let res = null;
    await rp({
        headers: headers,
        uri: uri,
        body: body,
        method: method,
        resolveWithFullResponse: true,
        followRedirect: false,
    }).catch(err => {
        res = err.response;
    })
    return res;
}

let savedEmail = '';
let savedPassword = '';

let rp = null;
let cookieJar = null;

exports.login = async function (email, password) {

    savedEmail = email;
    savedPassword = password;

    cookieJar = RP.jar();
    rp = RP.defaults({ jar: cookieJar });
    
    let res = null;
    let csrf = '';

    auth_headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 6.0.1; D5803 Build/23.5.A.1.291; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/63.0.3239.111 Mobile Safari/537.36'
    };
    
    // Call landing page and get csrf
    res = await rp({
        uri: landing_page_url,
        resolveWithFullResponse: true,
        method: 'GET',
    });
    csrf = extract_csrf(res.body);

    // Get login url
    auth_headers["Referer"] = base_url + '/portal';
    auth_headers["X-CSRF-Token"] = csrf;
    res = await rp({
        headers: auth_headers,
        uri: get_login_url,
        resolveWithFullResponse: true,
        followAllRedirects: true,
        method: 'POST',
    });
    const login_url = JSON.parse(res.body).loginURL["path"];

    // Get login form url
    res = await catchRedirect(login_url, auth_headers, '', 'GET');
    const login_form_url = res.headers.location;

    // Get login action url
    res = await rp({
        headers: auth_headers,
        uri: login_form_url,
        resolveWithFullResponse: true,
        followAllRedirects: true,
        method: 'GET',
    });
    const login_action_url = auth_base_url + extract_login_action_url(res.body);
    const login_relay_state_token = extract_login_relay_state_token(res.body);
    const hmac_token = extract_login_hmac(res.body);
    const login_csrf = extract_login_csrf(res.body);

    // Send login user name
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
    res = await rp({
        headers: auth_headers,
        uri: login_action_url,
        form: form,
        method: 'POST',
        resolveWithFullResponse: true,
        followAllRedirects: true,
    }).catch(err => {
        console.log("Post error: " + err.response.statusCode);
        console.log("headers: ", err.response.headers);
        console.log("Message: ", err.message);
    });

    let login_action2_url = '';
    const login_action_url_response_data = remove_whitespace(res.body);
    try {
        login_action2_url = auth_base_url + extract_login_action2_url(login_action_url_response_data);
    } catch (e) {
        console.error('weconnect: Failed to log in. Wrong user: ', email);
        process.exit(1);
    }
    const login_relay_state_token2 = extract_login_relay_state_token(login_action_url_response_data);
    const hmac_token2 = extract_login_hmac(login_action_url_response_data);
    const login_csrf2 = extract_login_csrf(login_action_url_response_data);

    // Send login password and get action url
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
    res = await rp({
        headers: auth_headers,
        uri: login_action2_url,
        form: form,
        method: 'POST',
        resolveWithFullResponse: true,
        followAllRedirects: true,
    }).catch(err => {
        console.log("Post error: " + err.response.statusCode);
        console.log("headers: ", err.response.headers);
        console.log("Message: ", err.message);
    });

    // Get base url
    let portlet_code = '';
    try {
        portlet_code = extract_code(res.request.path);
    } catch (e) {
        console.error('weconnect: Failed to log in. Wrong password.');
        process.exit(1);
    }
    csrf = extract_csrf(res.body);
    const complete_login_url = build_complete_login_url(csrf);
    auth_headers["Referer"] = login_action2_url
    data = {
        '_33_WAR_cored5portlet_code': portlet_code
    };
    form = JSON_to_URLEncoded(data);
    contentLength = form.length;
    auth_headers['Content-Length'] = contentLength;
    res = await catchRedirect(complete_login_url, auth_headers, form, 'POST');
    const api_url = res.headers.location;

    // Complete login and get final state
    delete auth_headers["Content-Length"];
    res = await rp({
        headers: auth_headers,
        uri: api_url,
        resolveWithFullResponse: true,
        followAllRedirects: true,
        method: 'GET',
    });

    csrf = extract_csrf(res.body);
    headers["Referer"] = api_url;
    headers["X-CSRF-Token"] = csrf;

    // Set global API url
    apiUrl = api_url
}

tryApi = async function (uri) {
    if (!apiUrl) {
        const msg = 'weconnect error: You must successfully call login before doing api calls.';
        console.error(msg);
        process.exit(1);
        return '';
    }

    let response = {
        statusCode: 0,
        body: 'No result'
    };

    await rp({
        headers: headers,
        uri: apiUrl + uri,
        method: 'POST',
        resolveWithFullResponse: true,
        followAllRedirects: true,
    })
        .then(res => {
            response = res;
        })
        .catch(err => {
            response = {
                statusCode: 0,
                body: err.message
            }
        });

    return response;
}

exports.api = async function (uri) {

    let response = await tryApi(uri);
    if(response.body == '{"errorCode":"2"}') {
        console.log('weconnect token expired. Logging in again.');
        await this.login(savedEmail, savedPassword);
        response = await tryApi(uri);
    }

    return response.body;
}


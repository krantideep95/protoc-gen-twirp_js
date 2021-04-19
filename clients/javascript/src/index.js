/**
 * encode a protobuf message to JSON
 * @param {*} msg a protobuf.js message
 * @returns {String} JSON serialized message
 */
const JSONSerialize = function (msg) {
  return JSON.stringify(msg.toObject());
};

/**
 *
 * @param {Uint8Array} buf buffer with JSON encoded protobuf message
 * @returns {object} A json object
 */
const JSONDeserialize = function (buf) {
  return JSON.parse(new TextDecoder().decode(buf));
};

/**
 *
 * @param msg a Protobuf message;
 * @returns {Uint8Array} buffer containing binary encoded protobuf message.
 */
const PBSerialize = function (msg) {
  return msg.encode().finish();
};
/**
 *
 * @param {*} responseType
 */
const PBDeserialize = (responseType) => (buffer) =>
  responseType.decode(buffer).toObject();

const makeHeaders = function (mime, version) {
  const obj = {};
  obj["Content-Type"] = mime;
  obj["Accept"] = mime;
  obj["Twirp-Version"] = version;
  return obj;
};

class TwirpRequest {
  constructor(url, opts) {
    this.url = url;
    this.opts = opts;
  }
}

const ClientHook = {
  //
  beforeSend: (request) => request,
  afterResponse: (request, resp) => resp,
  onError: (request, err) => {},
};

const defaultFactoryOptions = {
  //
  pathPrefix: "/twirp",
  hook: {},
  useJSON: false,
};

const clientFactory = function (opts) {
  const fetchFn = opts.fetchFn;

  if (!fetchFn) {
    throw Error("fetchFn is not set");
  }

  const hook = opts.hook || defaultFactoryOptions.hook;

  return function (baseurl, serviceName, twirpVersion) {
    const pathPrefix = opts.pathPrefix || defaultFactoryOptions.pathPrefix;
    const useJSON = opts.useJSON || defaultFactoryOptions.useJSON;

    const serviceEndpoint =
      baseurl.replace(/\/$/, "") + pathPrefix + "/" + serviceName + "/";

    const mimeType = useJSON ? "application/json" : "application/protobuf";
    const serialize = useJSON ? JSONSerialize : PBSerialize;
    const headers = makeHeaders(mimeType, twirpVersion);

    const rpc = function (method, requestMsg, responseType, callOpts) {
      const deserialize = useJSON
        ? JSONDeserialize
        : PBDeserialize(responseType);
      let opts = {
        method: "POST",
        body: serialize(requestMsg),
        redirect: "manual",
        headers: headers,
      };
      let req = new TwirpRequest(serviceEndpoint + method, opts);

      if (hook.beforeSend) {
        req = hook.beforeSend(req);
      }
      Object.assign(req.opts, callOpts);

      let respPromise = fetchFn(req.url, req.opts).then((
        /** @type {{ status: number; body: Promise<Response>; }} */ res
      ) => {
        if (res.status !== 200) {
          return resToError(res);
        }

        if (hook.afterResponse) {
          res = hook.afterResponse(req, res);
        }

        return res.body
          .then((body) => body.arrayBuffer())
          .then((buffer) => deserialize(new Uint8Array(buffer)));
      });
      if (hook.onError) {
        respPromise.catch((err) => hook.onError(req, err));
      }
      return respPromise;
    };
    return rpc;
  };
};

// Twirp Error implementation
function resToError(res) {
  return res.json().then(
    (obj) => {
      if (!obj.code || !obj.msg) {
        throw intermediateError(obj);
      }
      throw new TwirpError(obj.msg, obj.code, res.status, obj.meta);
    },
    () => {
      throw intermediateError({});
    }
  );

  function intermediateError(meta) {
    return new TwirpError({
      code: "internal",
      msg:
        "Error from intermediary with HTTP status code " +
        res.status +
        " " +
        res.statusText,
      meta: meta,
      status: res.status,
    });
  }
}

class TwirpError extends Error {
  constructor(msg, code, status, meta) {
    super(msg);
    this.meta = meta;
    this.code = code;
    this.status = status;
  }
}

export {
  TwirpError, clientFactory
}
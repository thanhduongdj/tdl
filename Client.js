const ref = require('ref')
const ffi = require('ffi')
const path = require('path')

const { buildQuery, getInput } = require('./utils')

class Client {
  constructor(options = {}) {
    const defaultOptions = {
      apiId: null,
      apiHash: null,
      binaryPath: 'libtdjson',
      verbosityLevel: 2,
    }
    this.options = {
      ...defaultOptions,
      ...options,
    }
    this.tdlib = ffi.Library(
      path.resolve(process.cwd(), this.options.binaryPath),
      {
        'td_json_client_create' :     [ref.refType('void'), []],
        'td_json_client_send'   :     [ref.types.void     , [ref.refType('void'), ref.types.CString]],
        'td_json_client_receive':     [ref.types.CString  , [ref.refType('void'), ref.types.double]],
        'td_json_client_execute':     [ref.types.CString  , [ref.refType('void'), ref.types.CString]],
        'td_json_client_destroy':     [ref.types.void     , [ref.refType('void')]],
        'td_set_log_verbosity_level': [ref.types.void     , [ref.types.int]],
      }
    )
    this.tdlib.td_set_log_verbosity_level(this.options.verbosityLevel)
    this.connect = () => new Promise((resolve, reject) => {
      this.resolver = resolve
      this.rejector = reject
    })
    this.init()
  }

  async init() {
    try {
      this.client = await this._create()
      this.loop()
    } catch (error) {
      this.rejector(`Error while creating client: ${error}`)
    }
  }

  async loop() {
    const update = await this._receive()
    console.log('>> update ', JSON.stringify(update, null, 2))
    if (!update) {
      console.log('Current update is empty.')
      return this.loop()
    }
    switch (update['@type']) {
      case 'updateAuthorizationState': {
        await this.handleAuth(update)
        break
      }
      case 'error': {
        await this.handleError(update)
        break
      }
      default:
        break
    }
    this.loop()
  }

  async handleAuth(update) {
    console.log(this.options)
    switch (update['authorization_state']['@type']) {
      case 'authorizationStateWaitTdlibParameters': {
        await this._send({
          '@type': 'setTdlibParameters',
          'parameters': {
            '@type': 'tdlibParameters',
            // 'use_test_dc': true,
            'database_directory': path.resolve(process.cwd(), '_td_database'),
            'files_directory': path.resolve(process.cwd(), '_td_files'),
            'use_message_database': true,
            'use_secret_chats': false,
            'api_id': this.options.apiId,
            'api_hash': this.options.apiHash,
            'system_language_code': 'en',
            'application_version': '1.0',
            'device_model': 'tdtest',
            'system_version': 'node',
            'enable_storage_optimizer': true,
          },
        })
        break
      }
      case 'authorizationStateWaitEncryptionKey': {
        await this._send({
          '@type': 'checkDatabaseEncryptionKey',
        })
        break
      }
      case 'authorizationStateWaitPhoneNumber': {
        await this._send({
          '@type': 'setAuthenticationPhoneNumber',
          'phone_number': this.options.phoneNumber,
        })
        break
      }
      case 'authorizationStateWaitCode': {
        const code = await getInput('input', 'Please enter auth code: ')
        await this._send({
          '@type': 'checkAuthenticationCode',
          'code': code,
        })
        break
      }
      case 'authorizationStateWaitPassword': {
        const passwordHint = update['authorization_state']['password_hint']
        const password = await getInput('password', `Please enter password (${passwordHint}): `)
        await this._send({
          '@type': 'checkAuthenticationPassword',
          'password': password,
        })
        break
      }
      case 'authorizationStateReady': {
        this.resolver()
        break
      }
      default:
        break
    }
  }

  async handleError(update) {
    switch (update['message']) {
      case 'PHONE_CODE_EMPTY':
      case 'PHONE_CODE_INVALID': {
        const code = await getInput('input', 'Wrong auth code, please re-enter: ')
        await this._send({
          '@type': 'checkAuthenticationCode',
          'code': code,
        })
        break
      }
      case 'PASSWORD_HASH_INVALID': {
        const password = await getInput('password', `Wrong password, please re-enter: `)
        await this._send({
          '@type': 'checkAuthenticationPassword',
          'password': password,
        })
        break
      }
      default:
        console.log('Uncaught error.')
        break
    }
  }

  _create() {
    return new Promise((resolve, reject) => {
      this.tdlib.td_json_client_create.async((err, client) => {
        if (err) {
          return reject(err)
        }
        resolve(client)
      })
    })
  }

  _send(query) {
    return new Promise((resolve, reject) => {
      this.tdlib.td_json_client_send.async(this.client, buildQuery(query), (err, response) => {
        if (err) {
          return reject(err)
        }
        if (!response) {
          return resolve(null)
        }
        resolve(JSON.parse(response))
      })
    })
  }

  _receive(timeout = 10) {
    return new Promise((resolve, reject) => {
      this.tdlib.td_json_client_receive.async(this.client, timeout, (err, response) => {
        if (err) {
          return reject(err)
        }
        if (!response) {
          return resolve(null)
        }
        resolve(JSON.parse(response))
      })
    })
  }

  _execute(query) {
    return new Promise((resolve, reject) => {
      try {
        const response = this.tdlib.td_json_client_execute(this.client, buildQuery(query))
        if (!response) {
          return resolve(null)
        }
        resolve(JSON.parse(response))
      } catch (err) {
        reject(err)
      }
    })
  }

  _destroy() {
    return new Promise((resolve) => {
      this.tdlib.td_json_client_destroy(this.client)
      this.client = null
      resolve()
    })
  }
}

module.exports = Client

'use strict';

require('reflect-metadata');
const _ = require('lodash');
const nodePath = require('path');
const fs = require('fs');

const StatusError = require('./src/exception/status-error');
const ControllerHandler = require('./src/handler/controller-handler');
const MethodHandler = require('./src/handler/method-handler');

const ctMap = new Map();
const ctHandler = new ControllerHandler();
const methodHandler = new MethodHandler(ctMap);
const swaggerHttpMethod = [ 'get', 'post', 'put', 'delete', 'patch' ];

const EggShell = (app, options = {}) => {
  const { router, jwt } = app;
  // 设置全局路由前缀
  if (options.prefix) router.prefix(options.prefix);
  options.before = options.before || [];
  options.after = options.after || [];

  let swaggerJson = null;
  // 开启swagger
  // 拼接swagger参数
  let swaggerOpt = null;
  if (options.swaggerOpt && options.swaggerOpt.open) {
    swaggerOpt = options.swaggerOpt;
    swaggerJson = {
      swagger: '2.0',
      info: {
        title: swaggerOpt.title || '',
        version: swaggerOpt.version || '',
      },
      host: swaggerOpt.port ? swaggerOpt.host + ':' + swaggerOpt.port : swaggerOpt.host,
      basePath: swaggerOpt.basePath || options.prefix,
      schemes: swaggerOpt.schemes || [ 'http' ],
      tags: [],
      paths: {},
      definitions: {}
    };

    // definition
    if (swaggerOpt.paths && swaggerOpt.paths.definitionPath) {
      const definitionPath = nodePath.join(__dirname, nodePath.normalize('../../' + swaggerOpt.paths.definitionPath));
      try {
        fs.statSync(definitionPath);
      } catch (error) {
        fs.mkdirSync(definitionPath);
      }
      const definitions = getDefinition({}, definitionPath) || {};
      swaggerJson.definitions = definitions;
    }
  }
  // 遍历传入MethodHandler类的map
  // 每一个控制器
  for (const c of ctMap.values()) {
    // 获取针对控制器的元数据
    let { ignoreJwtAll, beforeAll, afterAll, prefix, tagsAll, hiddenAll, tokenTypeAll, renderController } = ctHandler.getMetada(c.constructor);
    // 控制器上的所有方法
    const propertyNames = _.filter(Object.getOwnPropertyNames(c), pName => {
      return pName !== 'constructor' && pName !== 'pathName' && pName !== 'fullPath';
    });

    // 解析前缀
    const fullPath = c.fullPath.
      split('\\').join('/').
      replace(/[\/]{2,9}/g, '/').
      replace(/(\.ts)|(\.js)/g, '');
    const rootPath = 'controller/';
    prefix = prefix || fullPath.substring(fullPath.indexOf(rootPath) + rootPath.length);
    prefix = prefix.startsWith('/') ? prefix : '/' + prefix;

    // 获取swagger映射
    let loadParameters = null;
    if (swaggerOpt && swaggerOpt.open) {
      if (tagsAll) {
        if (!tagsAll.name) tagsAll.name = prefix;
        swaggerJson.tags.push(tagsAll);
      }

      if (swaggerOpt && swaggerOpt.paths && swaggerOpt.paths.swaggerPath) {
        const swaggerPath = nodePath.join(__dirname, nodePath.normalize('../../' + swaggerOpt.paths.swaggerPath));
        // 检查文件是否存在，不存在则创建文件
        try {
          fs.statSync(swaggerPath);
        } catch (error) {
          fs.mkdirSync(swaggerPath);
        }

        try {
          const parameterFilePath = nodePath.join(swaggerPath, prefix + '.json');
          if (fs.statSync(parameterFilePath)) {
            loadParameters = JSON.parse(fs.readFileSync(parameterFilePath, { encoding: 'utf8' }));
          }
        } catch (error) {}
      }
    }
    // 遍历当前控制器上的方法
    for (const pName of propertyNames) {
      // 解析函数元数据
      // 拿到该方法的元数据
      let { reqMethod, path, before, after, message, ignoreJwt, tags, summary, description, parameters, responses, produces, consumes, hidden, tokenType, render } = methodHandler.getMetada(c[pName]);
      const befores = [ ...options.before, ...beforeAll, ...before ];
      const afters = [ ...options.after, ...afterAll, ...after ];
      // 进行swagger的参数配置
      if (swaggerOpt && swaggerOpt.open && !hiddenAll && !hidden) {
        let finallyPath = prefix + path;
        finallyPath = replaceColon(finallyPath);

        if (loadParameters && loadParameters[path] && loadParameters[path][reqMethod]) {
          const curRoute = loadParameters[path][reqMethod];
          if ((!tags || tags.length === 0) && curRoute.tags) {
            tags = curRoute.tags;
          }
          if ((!parameters || parameters.length === 0) && curRoute.parameters) {
            parameters = curRoute.parameters;
          }
          if (!responses && curRoute.responses) {
            responses = curRoute.responses;
          }
          if ((!produces || produces.length === 0) && curRoute.produces) {
            produces = curRoute.produces;
          }
          if ((!consumes || consumes.length === 0) && curRoute.consumes) {
            consumes = curRoute.consumes;
          }
          if (!description && curRoute.description) {
            description = curRoute.description;
          }
          if (!summary && curRoute.summary) {
            summary = curRoute.summary;
          }
        }

        if (!_.isEmpty(swaggerOpt.tokenOpt) && jwt && !ignoreJwtAll && !ignoreJwt) {
          const tokenOpt = swaggerOpt.tokenOpt;
          let token = null;
          if (!_.isEmpty(tokenOpt.tokens)) {
            let globalTokenType = null;
            let partTokenType = null;
            if (loadParameters) {
              globalTokenType = loadParameters.tokenType || null;
              if (loadParameters[path] && loadParameters[path][reqMethod] && loadParameters[path][reqMethod].tokenType) {
                partTokenType = loadParameters[path][reqMethod].tokenType || null;
              }
            }
            let defaultTokenType = tokenType || tokenTypeAll || tokenOpt.defaultTokenType || partTokenType || globalTokenType;
            if (!defaultTokenType) {
              defaultTokenType = Object.keys(tokenOpt.tokens)[0];
            }
            token = tokenOpt.tokens[defaultTokenType];
          } else if (tokenOpt.token) {
            token = tokenOpt.token;
          }
          if (token) {
            parameters.unshift({
              name: 'Authorization', in: 'header', description: 'Token', type: 'string', defaultValue: 'Bearer ' + token
            });
          }
        }

        if (swaggerHttpMethod.indexOf(reqMethod) >= 0) {
          if (!swaggerJson.paths[finallyPath]) {
            swaggerJson.paths[finallyPath] = {};
          }
          swaggerJson.paths[finallyPath][reqMethod] = {
            tags: ((tags && !Array.isArray(tags)) ? [ tags ] : tags) || [ prefix ],
            summary: summary || description,
            description,
            produces: (produces && !Array.isArray(produces)) ? [ produces ] : produces,
            consumes: (consumes && !Array.isArray(consumes)) ? [ consumes ] : consumes,
            parameters,
            responses
          };
        }
      }
      // 封装真正的router回调
      const routerCb = async (ctx, next) => {
        const instance = new c.constructor(ctx);
        try {
          if (!ignoreJwt && !ignoreJwtAll && jwt && options.jwtValidation) {
            await options.jwtValidation()(ctx, next);
          }
          // 面向切片执行before
          for (const before of befores) {
            await before()(ctx, next);
          }
          ctx.body = ctx.request ? ctx.request.body : null;
          // 执行控制器的对应方法，将结果返回到body上
          const result = await instance[pName](ctx);
          if (options.quickStart && !render && !renderController) {
            ctx.response.body = {
              success: true,
              message,
              data: result,
            };
          } else if (renderController || render) {
            ctx.set('Content-Type', 'text/html;charset=utf-8');
          }
          // 面向切片执行afters
          for (const after of afters) {
            await after()(ctx, next);
          }
        } catch (error) {
          throw error;
        }
      };
      // 将对应方法和回调挂载在router上
      router[reqMethod](prefix + path, routerCb);
    }
  }

  if (swaggerOpt && swaggerOpt.open && swaggerOpt.paths && swaggerOpt.paths.outPath) {
    const outPath = nodePath.join(__dirname, nodePath.normalize('../../' + swaggerOpt.paths.outPath));
    const stat = fs.statSync(outPath);
    if (stat) {
      // 最后写到swagger文件上
      fs.writeFileSync(outPath, JSON.stringify(swaggerJson), { encoding: 'utf8' });
    }
  }
};

const paramsRegex = /:[\w-]*/g;
function replaceColon (path) {
  const matchs = paramsRegex.exec(path);
  if (!matchs) return path;
  const pathItem = matchs[0].replace(':', '{') + '}';
  path = path.replace(matchs[0], pathItem);
  return replaceColon(path);
}

function getDefinition (definitions, definitionPath) {
  const files = fs.readdirSync(definitionPath, { encoding: 'utf8' });
  for (const file of files) {
    const subDefinitionPath = nodePath.join(definitionPath, file);
    const stat = fs.statSync(subDefinitionPath);
    if (stat.isFile()) {
      const data = fs.readFileSync(subDefinitionPath, { encoding: 'utf8' });
      definitions = Object.assign(definitions, JSON.parse(data));
    } else if (stat.isDirectory()) {
      definitions = Object.assign(definitions, this._getDefinition(definitions, subDefinitionPath));
    }
  }
  return definitions;
}

module.exports = {
  EggShell,
  // 将异常对象对外暴露
  StatusError,

  Get: methodHandler.get(),
  Post: methodHandler.post(),
  Put: methodHandler.put(),
  Delete: methodHandler.delete(),
  Patch: methodHandler.patch(),
  Options: methodHandler.options(),
  Head: methodHandler.head(),

  Before: methodHandler.before(),
  After: methodHandler.after(),
  Message: methodHandler.message(),
  IgnoreJwt: methodHandler.ignoreJwt(),

  Tags: methodHandler.tags(),
  Summary: methodHandler.summary(),
  Description: methodHandler.description(),
  Parameters: methodHandler.parameters(),
  Responses: methodHandler.responses(),
  Produces: methodHandler.produces(),
  Consumes: methodHandler.consumes(),
  Hidden: methodHandler.hidden(),
  TokenType: methodHandler.tokenType(),
  Render: methodHandler.render(),

  IgnoreJwtAll: ctHandler.ignoreJwtAll(),
  BeforeAll: ctHandler.beforeAll(),
  AfterAll: ctHandler.afterAll(),
  Prefix: ctHandler.prefix(),
  TagsAll: ctHandler.tagsAll(),
  HiddenAll: ctHandler.hiddenAll(),
  TokenTypeAll: ctHandler.tokenTypeAll(),
  RenderController: ctHandler.renderController()
};

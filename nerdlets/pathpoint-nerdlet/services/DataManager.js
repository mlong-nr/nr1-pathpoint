/* eslint-disable prefer-template */
/* eslint-disable no-loop-func */
/* eslint-disable require-atomic-updates */

// IMPORT LIBRARIES DEPENDENCIES
import NerdletData from '../../../nr1.json';
import TouchPoints from '../config/touchPoints.json';
import Canary from '../config/canary_states.json';
import ViewData from '../config/view.json';
import appPackage from '../../../package.json';
import { historicErrorScript } from '../../../synthetics/createHistoricErrorScript';
import {
  AccountStorageMutation,
  AccountsQuery,
  AccountStorageQuery,
  NerdGraphQuery,
  logger
} from 'nr1';

import LogConnector from './LogsConnector';

// DEFINE AND EXPORT CLASS
export default class DataManager {
  constructor() {
    this.LogConnector = new LogConnector();
    this.minPercentageError = 100;
    this.historicErrorsHours = 192;
    this.historicErrorsHighLightPercentage = 26;
    this.dropParams = null;
    this.version = null;
    this.accountId = null;
    this.graphQlmeasures = [];
    this.touchPointsCopy = null;
    this.city = 0;
    this.pathpointId = NerdletData.id;
    this.touchPoints = TouchPoints;
    this.stages = [];
    this.lastStorageVersion = null;
    this.stepsByStage = [];
    this.dataCanary = Canary;
    this.configuration = {
      pathpointVersion: null,
      kpis: [],
      stages: []
    };
    this.configurationJSON = {};
    this.measureNames = [
      'PRC-COUNT-QUERY',
      'PCC-COUNT-QUERY',
      'APP-HEALTH-QUERY',
      'FRT-HEALTH-QUERY',
      'SYN-CHECK-QUERY',
      'WORKLOAD-QUERY'
    ];
    this.accountIDs = [
      {
        name: 'NAME',
        id: 0
      }
    ];
    this.detaultTimeout = 10;
  }

  async BootstrapInitialData(accountName) {
    await this.GetAccountId(accountName);
    logger.log('Accounts::');
    this.accountIDs.forEach(account => {
      logger.log(`AccountName:${account.name}   ID:${account.id} `);
    });
    await this.CheckVersion();
    await this.GetCanaryData();
    await this.GetStorageHistoricErrorsParams();
    await this.GetStorageDropParams();
    this.version = appPackage.version;
    if (this.lastStorageVersion === appPackage.version) {
      this.colors = ViewData.colors;
      await this.GetInitialDataFromStorage();
      this.GetStorageTouchpoints();
    } else {
      this.stages = ViewData.stages;
      this.colors = ViewData.colors;
      this.kpis = ViewData.kpis ?? [];
      this.SetInitialDataViewToStorage();
      this.SetStorageTouchpoints();
      this.SetVersion();
    }
    this.stepsByStage = this.GetStepsByStage();
    return {
      stages: [...this.stages],
      kpis: [...this.kpis],
      colors: this.colors,
      accountId: this.accountId,
      version: this.version,
      totalContainers: this.SetTotalContainers(),
      accountIDs: this.accountIDs
    };
  }

  SetTotalContainers() {
    let total = 0;
    this.stages.forEach(stage => {
      if (stage.steps.length > total) {
        total = stage.steps.length;
      }
    });
    return total;
  }

  async UpdateData(
    timeRange,
    city,
    getOldSessions,
    stages,
    kpis,
    timeRangeKpi
  ) {
    if (this.accountId !== null) {
      console.log(`UPDATING-DATA: ${this.accountId}`);
      // console.log('KKPPIs:',this.kpis);
      // this.AddCustomAccountIDs();
      this.timeRange = timeRange;
      this.city = city;
      this.getOldSessions = getOldSessions;
      this.stages = stages;
      this.kpis = kpis;
      this.timeRangeKpi = timeRangeKpi;
      await this.TouchPointsUpdate();
      await this.UpdateMerchatKpi();
      this.CalculateUpdates();
      return {
        stages: this.stages,
        kpis: this.kpis
      };
    }
  }

  async GetAccountId(accountName) {
    try {
      const { data } = await AccountsQuery.query();
      if (data.length > 0) {
        this.FillAccountIDs(data);
        this.AddCustomAccountIDs();
        if (accountName !== '') {
          data.some(account => {
            let found = false;
            if (account.name === accountName) {
              this.accountId = account.id;
              found = true;
            }
            if (!found) {
              // If AccountName is not found use the first account
              this.accountId = data[0].id;
            }
            return found;
          });
        } else {
          // By default capture the First Account in the List
          this.accountId = data[0].id;
        }
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  FillAccountIDs(data) {
    this.accountIDs.length = 0;
    data.forEach(account => {
      this.accountIDs.push({
        name: account.name,
        id: account.id
      });
    });
  }

  AddCustomAccountIDs() {
    this.removeCustomIDs();
    let ids = '--';
    this.accountIDs.forEach(acc => {
      ids += acc.id + '--';
    });
    const initial_length = ids.length;
    this.touchPoints.forEach(element => {
      element.touchpoints.forEach(touchpoint => {
        touchpoint.measure_points.forEach(measure => {
          if (measure.accountID) {
            if (ids.indexOf('--' + measure.accountID + '--') === -1) {
              ids += measure.accountID + '--';
            }
          }
        });
      });
    });
    if (ids.length > initial_length) {
      const newIds = ids.substring(initial_length, ids.length - 2).split('--');
      newIds.forEach(newId => {
        this.accountIDs.push({
          name: 'Custom ID',
          id: parseInt(newId)
        });
      });
    }
  }

  removeCustomIDs() {
    while (this.accountIDs[this.accountIDs.length - 1].name === 'Custom ID') {
      this.accountIDs.pop();
    }
  }

  async CheckVersion() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'version'
      });
      if (data) {
        this.lastStorageVersion = data.Version;
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  async GetInitialDataFromStorage() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'newViewJSON'
      });
      if (data) {
        this.stages = data.ViewJSON;
        this.kpis = data.Kpis ?? [];
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  SetInitialDataViewToStorage() {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'newViewJSON',
        document: {
          ViewJSON: this.stages,
          Kpis: this.kpis
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  SaveKpisSelection(kpis) {
    this.kpis = kpis;
    this.SetInitialDataViewToStorage();
  }

  GetStepsByStage() {
    const reply = [];
    let idx = 0;
    this.stages.forEach(stage => {
      idx = stage.steps[stage.steps.length - 1].sub_steps.length - 1;
      reply.push(stage.steps[stage.steps.length - 1].sub_steps[idx].index);
    });
    return reply;
  }

  async GetCanaryData() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'dataCanary'
      });
      if (data) {
        this.dataCanary = data.dataCanary;
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  SaveCanaryData(data) {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'dataCanary',
        document: {
          dataCanary: data
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  async TouchPointsUpdate() {
    this.graphQlmeasures.length = 0;
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        element.touchpoints.forEach(touchpoint => {
          if (touchpoint.status_on_off) {
            touchpoint.measure_points.forEach(measure => {
              const extraInfo = {
                measureType: 'touchpoint',
                touchpointName: touchpoint.value,
                stageName: this.stages[touchpoint.stage_index - 1].title
              };
              this.FetchMeasure(measure, extraInfo);
            });
          }
        });
      }
    });
    if (this.graphQlmeasures.length > 0) {
      await this.NRDBQuery();
    }
  }

  ClearMeasure(measure) {
    switch (measure.type) {
      case 'PRC':
        measure.session_count = 0;
        break;
      case 'PCC':
        measure.transaction_count = 0;
        break;
      case 'APP':
      case 'FRT':
        measure.apdex_value = 1;
        measure.response_value = 0;
        measure.error_percentage = 0;
        break;
      case 'SYN':
        measure.success_percentage = 0;
        measure.max_duration = 0;
        measure.max_request_time = 0;
        break;
      case 'WLD':
        measure.status_value = 'NO-VALUE';
        break;
    }
  }

  async ReadQueryResults(query, accountID) {
    const measure = {
      accountID: accountID,
      type: 'TEST',
      results: null
    };
    this.graphQlmeasures.length = 0;
    this.graphQlmeasures.push([measure, query, null]);
    await this.NRDBQuery();
    return measure;
  }

  FetchMeasure(measure, extraInfo = null) {
    this.ClearMeasure(measure);
    if (measure.query !== '') {
      let query = `${measure.query} SINCE ${this.TimeRangeTransform(
        this.timeRange,
        false
      )}`;
      if (measure.measure_time) {
        query = `${measure.query} SINCE ${measure.measure_time}`;
      }
      if (measure.type === 'WLD') {
        query = measure.query;
      }
      this.graphQlmeasures.push([measure, query, extraInfo]);
    }
  }

  TimeRangeTransform(timeRange, sessionsRange) {
    let time_start = 0;
    let time_end = 0;
    if (timeRange === '5 MINUTES AGO') {
      if (sessionsRange && this.getOldSessions) {
        time_start = Math.floor(Date.now() / 1000) - 10 * 59;
        time_end = Math.floor(Date.now() / 1000) - 5 * 58;
        return `${time_start} UNTIL ${time_end}`;
      }
      return timeRange;
    }
    switch (timeRange) {
      case '30 MINUTES AGO':
        time_start = Math.floor(Date.now() / 1000) - 40 * 60;
        time_end = Math.floor(Date.now() / 1000) - 30 * 60;
        break;
      case '60 MINUTES AGO':
        time_start = Math.floor(Date.now() / 1000) - 70 * 60;
        time_end = Math.floor(Date.now() / 1000) - 60 * 60;
        break;
      case '3 HOURS AGO':
        time_start = Math.floor(Date.now() / 1000) - 3 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 3 * 60 * 60;
        break;
      case '6 HOURS AGO':
        time_start = Math.floor(Date.now() / 1000) - 6 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 6 * 60 * 60;
        break;
      case '12 HOURS AGO':
        time_start = Math.floor(Date.now() / 1000) - 12 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 12 * 60 * 60;
        break;
      case '24 HOURS AGO':
        time_start = Math.floor(Date.now() / 1000) - 24 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
        break;
      case '3 DAYS AGO':
        time_start = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
        break;
      case '7 DAYS AGO':
        time_start = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60 - 10 * 60;
        time_end = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
        break;
      default:
        return timeRange;
    }
    if (sessionsRange && this.getOldSessions) {
      time_start = time_start - 10 * 59;
      time_end = time_end - 5 * 58;
    }
    return `${time_start} UNTIL ${time_end}`;
  }

  SendToLogs(logRecord) {
    this.LogConnector.SendLog(logRecord);
  }

  MakeLogingData(startMeasureTime, endMeasureTime, data, errors) {
    if (errors && errors.length > 0) {
      // TODO
      errors.forEach(error => {
        if (Reflect.has(error, 'path')) {
          for (const [, value] of Object.entries(error.path)) {
            const c = value.split('_');
            if (c[0] === 'measure') {
              const measure = this.graphQlmeasures[Number(c[1])][0];
              const query = this.graphQlmeasures[Number(c[1])][1];
              const extraInfo = this.graphQlmeasures[Number(c[1])][2];
              let accountID = this.accountId;
              if (Reflect.has(measure, 'accountID')) {
                accountID = measure.accountID;
              }
              if (extraInfo.measureType === 'touchpoint') {
                const logRecord = {
                  action: 'touchpoint-error',
                  account_id: accountID,
                  error: true,
                  error_message: JSON.stringify(error),
                  query: query,
                  touchpoint_name: extraInfo.touchpointName,
                  touchpoint_type: measure.type,
                  stage_name: extraInfo.stageName
                };
                this.SendToLogs(logRecord);
              }
              if (extraInfo.measureType === 'kpi') {
                const logRecord = {
                  action: 'kpi-error',
                  account_id: accountID,
                  error: true,
                  error_message: JSON.stringify(error),
                  query: query,
                  kpi_name: extraInfo.kpiName,
                  kpi_type: extraInfo.kpiType
                };
                this.SendToLogs(logRecord);
              }
            }
          }
        }
      });
    }
    if (data && data.actor) {
      for (const [key, value] of Object.entries(data.actor)) {
        const c = key.split('_');
        if (
          c[0] === 'measure' &&
          value &&
          value.nrql &&
          Reflect.has(value, 'nrql') &&
          Reflect.has(value.nrql, 'results')
        ) {
          const measure = this.graphQlmeasures[Number(c[1])][0];
          const query = this.graphQlmeasures[Number(c[1])][1];
          const extraInfo = this.graphQlmeasures[Number(c[1])][2];
          const totalMeasures = this.graphQlmeasures.length;
          const timeByMeasure =
            (endMeasureTime - startMeasureTime) / totalMeasures;
          if (extraInfo !== null) {
            let accountID = this.accountId;
            if (Reflect.has(measure, 'accountID')) {
              accountID = measure.accountID;
            }
            if (extraInfo.measureType === 'touchpoint') {
              const logRecord = {
                action: 'touchpoint-query',
                account_id: accountID,
                error: false,
                query: query,
                results: JSON.stringify(value.nrql.results),
                duration: timeByMeasure,
                touchpoint_name: extraInfo.touchpointName,
                touchpoint_type: measure.type,
                stage_name: extraInfo.stageName
              };
              this.SendToLogs(logRecord);
            }
            if (extraInfo.measureType === 'kpi') {
              if (Reflect.has(measure.queryByCity[this.city], 'accountID')) {
                accountID = measure.queryByCity[this.city].accountID;
              }
              const logRecord = {
                action: 'kpi-query',
                account_id: accountID,
                error: false,
                query: query,
                results: JSON.stringify(value.nrql.results),
                duration: timeByMeasure,
                kpi_name: extraInfo.kpiName,
                kpi_type: extraInfo.kpiType
              };
              this.SendToLogs(logRecord);
            }
          }
        }
      }
    }
  }

  async NRDBQuery() {
    const startMeasureTime = Date.now();
    const { data, errors, n } = await this.EvaluateMeasures();
    const endMeasureTime = Date.now();
    this.MakeLogingData(startMeasureTime, endMeasureTime, data, errors);
    if (n === 0) {
      return 0;
    }
    if (errors && errors.length > 0) {
      console.log('NRDB-Error:', errors);
    }
    if (data && data.actor) {
      for (const [key, value] of Object.entries(data.actor)) {
        const c = key.split('_');
        if (value !== null) {
          if (c[0] === 'measure') {
            const measure = this.graphQlmeasures[Number(c[1])][0];
            // const query = this.graphQlmeasures[Number(c[1])][1];
            // console.log('Query:',query);
            // console.log('Result',value);
            if (
              measure.type === 'PRC' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'session'
              )
            ) {
              measure.session_count = value.nrql.results[0].session;
            } else if (
              measure.type === 'PCC' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'count'
              )
            ) {
              measure.transaction_count = value.nrql.results[0].count;
            } else if (
              measure.type === 'APP' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'apdex'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'score'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'response'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'error'
              )
            ) {
              measure.apdex_value = value.nrql.results[0].score;
              measure.response_value = value.nrql.results[0].response;
              measure.error_percentage = value.nrql.results[0].error;
            } else if (
              measure.type === 'FRT' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'apdex'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'score'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'response'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'error'
              )
            ) {
              measure.apdex_value = value.nrql.results[0].score;
              measure.response_value = value.nrql.results[0].response;
              measure.error_percentage = value.nrql.results[0].error;
            } else if (
              measure.type === 'SYN' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'success'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'duration'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'request'
              )
            ) {
              measure.success_percentage = value.nrql.results[0].success;
              measure.max_duration = value.nrql.results[0].duration;
              measure.max_request_time = value.nrql.results[0].request;
            } else if (
              measure.type === 'WLD' &&
              value.nrql !== null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'statusValue'
              )
            ) {
              measure.status_value = value.nrql.results[0].statusValue;
            } else if (
              measure.type === 100 &&
              value.nrql != null &&
              value.nrql.results &&
              value.nrql.results[0] &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'value'
              )
            ) {
              measure.value = value.nrql.results[0].value;
            } else if (
              measure.type === 101 &&
              value.nrql != null &&
              value.nrql.results &&
              value.nrql.results.length === 2 &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'value'
              ) &&
              Object.prototype.hasOwnProperty.call(
                value.nrql.results[0],
                'comparison'
              )
            ) {
              if (value.nrql.results[0].comparison === 'current') {
                measure.value.current = value.nrql.results[0].value;
                measure.value.previous = value.nrql.results[1].value;
              } else {
                measure.value.current = value.nrql.results[1].value;
                measure.value.previous = value.nrql.results[0].value;
              }
            } else if (measure.type === 'TEST') {
              measure.results = value.nrql.results[0];
            }
          }
        }
      }
    }
  }

  async EvaluateMeasures() {
    let accountID = this.accountId;
    let gql = `{
     actor {`;
    let alias = '';
    let n = 0;
    const itemsByPage = 45;
    if (this.graphQlmeasures.length > itemsByPage) {
      const dataReturn = {
        actor: {}
      };
      const errorsReturn = [];
      let control = 0;
      const pages = Math.ceil(this.graphQlmeasures.length / itemsByPage);
      for (let i = 0; i < pages; i++) {
        const dataSplit = this.graphQlmeasures.slice(
          control,
          control + itemsByPage
        );
        dataSplit.forEach(nrql => {
          accountID = this.accountId;
          if (Reflect.has(nrql[0], 'accountID')) {
            accountID = nrql[0].accountID;
          }
          // Special Change ONLY for KPI-MULTI-ACCOINT-MEASURES
          if (nrql[0].type === 100 || nrql[0].type === 101) {
            if (Reflect.has(nrql[0].queryByCity[this.city], 'accountID')) {
              accountID = nrql[0].queryByCity[this.city].accountID;
            }
          }
          // Check if the Measure have a Timeout Defined
          let timeOut = this.detaultTimeout;
          if (Reflect.has(nrql[0], 'timeout')) {
            timeOut = nrql[0].timeout;
          }
          alias = `measure_${n}`;
          n += 1;
          gql += `${alias}: account(id: ${accountID}) {
              nrql(query: "${this.escapeQuote(nrql[1])}", timeout: ${timeOut}) {
                  results
              }
          }`;
        });
        gql += `}}`;
        const { data, errors } = await NerdGraphQuery.query({
          query: gql
        }).catch(errors => {
          return { errors: [{ errors }] };
        });
        if (data && data.actor)
          dataReturn.actor = Object.assign(dataReturn.actor, data.actor);
        if (errors && errors.length > 0) errorsReturn.push(errors);
        gql = `{
            actor {`;
        alias = '';
        control += itemsByPage;
      }
      return {
        data: dataReturn,
        n,
        errors: errorsReturn
      };
    } else {
      this.graphQlmeasures.forEach(nrql => {
        // check if the measure is MULTI-ACCOUNT
        accountID = this.accountId;
        if (Reflect.has(nrql[0], 'accountID')) {
          accountID = nrql[0].accountID;
        }
        // Special Change ONLY for KPI-MULTI-ACCOINT-MEASURES
        if (nrql[0].type === 100 || nrql[0].type === 101) {
          if (Reflect.has(nrql[0].queryByCity[this.city], 'accountID')) {
            accountID = nrql[0].queryByCity[this.city].accountID;
          }
        }
        // Check if the Measure have a Timeout Defined
        let timeOut = this.detaultTimeout;
        if (Reflect.has(nrql[0], 'timeout')) {
          timeOut = nrql[0].timeout;
        }
        alias = `measure_${n}`;
        n += 1;
        gql += `${alias}: account(id: ${accountID}) {
            nrql(query: "${this.escapeQuote(nrql[1])}", timeout: ${timeOut}) {
                results
            }
        }`;
      });
      gql += `}}`;
      const { data, errors } = await NerdGraphQuery.query({ query: gql }).catch(
        errors => {
          return { errors: [{ errors }] };
        }
      );
      return { data, n, errors };
    }
  }

  escapeQuote(data) {
    return data.replace(/["]/g, '\\"');
  }

  SetSessions(measure, sessions) {
    const new_sessions = [];
    sessions.forEach(session => {
      new_sessions.push({
        id: session.facet,
        time: this.SetSessionTime(measure.sessions, session.facet)
      });
    });
    measure.sessions = new_sessions;
  }

  SetSessionTime(measure_sessions, sessionID) {
    let session_time = Math.floor(Date.now() / 1000);
    if (this.getOldSessions) {
      session_time = session_time - 5 * 58;
    }
    measure_sessions.some(m_sess => {
      let found = false;
      if (m_sess.id === sessionID) {
        session_time = m_sess.time;
        found = true;
      }
      return found;
    });
    return session_time;
  }

  SetLogsMeasure(measure, results) {
    const total = results.R1 + results.R2;
    measure.count = results.R1;
    if (total === 0) {
      measure.error_percentage = 0;
    } else {
      measure.error_percentage = Math.round((results.R2 / total) * 10000) / 100;
    }
  }

  async UpdateMerchatKpi() {
    this.graphQlmeasures.length = 0;
    for (let i = 0; i < this.kpis.length; i++) {
      if (this.kpis[i].check) {
        const extraInfo = {
          measureType: 'kpi',
          kpiName: this.kpis[i].name,
          kpiType: this.kpis[i].type
        };
        this.graphQlmeasures.push([
          this.kpis[i],
          this.kpis[i].queryByCity[this.city].query +
          ' SINCE ' +
          this.timeRangeKpi.range,
          extraInfo
        ]);
      }
      this.kpis[i].link = this.kpis[i].queryByCity[this.city].link;
    }
    await this.NRDBQuery();
  }

  CalculateUpdates() {
    this.ClearTouchpointError();
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        this.CountryCalculateUpdates(element);
      }
    });
  }

  ClearTouchpointError() {
    for (let i = 0; i < this.stages.length; i++) {
      this.stages[i].touchpoints.forEach(touchpoint => {
        touchpoint.error = false;
      });
      this.stages[i].steps.forEach(step => {
        step.sub_steps.forEach(sub_step => {
          sub_step.error = false;
        });
      });
    }
  }

  CountryCalculateUpdates(element) {
    const values = this.Getmeasures(element);
    for (let i = 0; i < this.stages.length; i++) {
      this.stages[i].status_color = 'good';
      this.stages[i].status_color = this.UpdateErrorCondition(
        this.stages[i].status_color,
        this.GetStageError(i + 1, element)
      );
      this.stages[i].total_count = values.count_by_stage[i].total_count;
      this.stages[i].trafficIconType = values.count_by_stage[i].traffic_type;

      this.stages[i].capacity = values.count_by_stage[i].capacity_status;

      let congestion = 0;
      if (values.count_by_stage[i].total_steps !== 0) {
        congestion =
          values.count_by_stage[i].num_steps_over_average /
          values.count_by_stage[i].total_steps;
        congestion = Math.floor(congestion * 10000) / 100;
      }
      this.stages[i].congestion.value = congestion;
      this.stages[i].congestion.percentage = congestion;
    }
    this.UpdateMaxCongestionSteps(values.count_by_stage);
  }

  Getmeasures(touchpoints_by_country) {
    const tpc = []; // Count Touchpoints totals by Stage
    this.stages.forEach(stage => {
      const rec = {
        traffic_type: 'traffic',
        num_touchpoints: 0,
        average: 0,
        total_count: 0,
        steps_indexes: [],
        total_steps: 0,
        num_steps_over_average: 0,
        max_congestion: 0,
        steps_max_cong: [],
        above_avg: stage.percentage_above_avg,
        steps_over_percentage_indexes: [],
        capacity_status: 'NO-VALUE'
      };
      tpc.push(rec);
    });
    touchpoints_by_country.touchpoints.forEach(touchpoint => {
      if (touchpoint.status_on_off) {
        const idx = touchpoint.stage_index - 1;
        touchpoint.measure_points.forEach(measure => {
          let count = 0;
          if (measure.type === 'PRC' || measure.type === 'PCC') {
            count =
              measure.type === 'PRC'
                ? measure.session_count
                : measure.transaction_count;
            tpc[idx].traffic_type =
              measure.type === 'PRC' ? 'people' : 'traffic';
            tpc[idx].num_touchpoints++;
            tpc[idx].total_count += count;
            tpc[idx].average = tpc[idx].total_count / tpc[idx].num_touchpoints;
            this.UpdateStepsIndexes(
              touchpoint.relation_steps,
              tpc[idx].steps_indexes
            );
            tpc[idx].total_steps = tpc[idx].steps_indexes.length;
          }
          if (measure.type === 'WLD') {
            tpc[idx].capacity_status = measure.status_value;
          }
        });
      }
    });
    // Setting Count Steps Over Average
    touchpoints_by_country.touchpoints.forEach(touchpoint => {
      if (touchpoint.status_on_off) {
        const idx = touchpoint.stage_index - 1;
        touchpoint.measure_points.forEach(measure => {
          let count = 0;
          if (measure.type === 'PRC' || measure.type === 'PCC') {
            count =
              measure.type === 'PRC'
                ? measure.session_count
                : measure.transaction_count;
            if (count > tpc[idx].average * (1 + tpc[idx].above_avg / 100)) {
              this.UpdateStepsIndexes(
                touchpoint.relation_steps,
                tpc[idx].steps_over_percentage_indexes
              );
              tpc[idx].num_steps_over_average =
                tpc[idx].steps_over_percentage_indexes.length;
              if (tpc[idx].max_congestion < count) {
                tpc[idx].max_congestion = count;
                tpc[idx].steps_max_cong = touchpoint.relation_steps;
              }
            }
          }
        });
      }
    });
    // console.log('TPC:', tpc);
    return {
      count_by_stage: tpc
    };
  }

  UpdateStepsIndexes(relation_steps, list) {
    let list_string = '';
    list.forEach(index => {
      list_string += '-' + index + '-';
    });
    relation_steps.forEach(index => {
      if (!list_string.includes('-' + index + '-')) {
        list_string += '-' + index + '-';
        list.push(index);
      }
    });
  }

  UpdateMaxCongestionSteps(count_by_stage) {
    for (let i = 0; i < this.stages.length; i++) {
      this.stages[i].steps.forEach(step => {
        step.sub_steps.forEach(sub_step => {
          sub_step.latency = false;
          count_by_stage[i].steps_max_cong.some(index => {
            let found = false;
            if (index === sub_step.index) {
              found = true;
              sub_step.latency = true;
            }
            return found;
          });
        });
      });
    }
  }

  // GetSessionsPercentage(sessions) {
  //   if (sessions.length === 0) {
  //     return 0;
  //   }
  //   let count = 0;
  //   const currentTime = Math.floor(Date.now() / 1000);
  //   sessions.forEach(session => {
  //     if (currentTime - session.time > 5 * 60) {
  //       count++;
  //     }
  //   });
  //   return count / sessions.length;
  // }

  UpdateErrorCondition(actual, nextvalue) {
    if (actual === 'danger') {
      return actual;
    }
    if (nextvalue === 'danger') {
      return nextvalue;
    }
    if (actual === 'warning') {
      return actual;
    }
    if (nextvalue === 'warning') {
      return nextvalue;
    }
    return actual;
  }

  GetStageError(stage, element) {
    let count_touchpoints = 0;
    const steps_with_error = [];
    while (steps_with_error.length < this.stepsByStage[stage - 1]) {
      steps_with_error.push(0);
    }
    element.touchpoints.forEach(touchpoint => {
      if (touchpoint.stage_index === stage && touchpoint.status_on_off) {
        count_touchpoints += 1;
        touchpoint.measure_points.forEach(measure => {
          let setError = false;
          if (
            measure.type === 'PRC' &&
            measure.session_count < measure.min_count
          ) {
            setError = true;
          } else if (
            measure.type === 'PCC' &&
            measure.transaction_count < measure.min_count
          ) {
            setError = true;
          } else if (measure.type === 'APP' || measure.type === 'FRT') {
            if (
              measure.error_percentage > measure.max_error_percentage ||
              measure.apdex_value < measure.min_apdex ||
              measure.response_value > measure.max_response_time
            ) {
              setError = true;
            }
          } else if (measure.type === 'SYN') {
            if (
              measure.success_percentage < measure.min_success_percentage ||
              measure.max_request_time > measure.max_avg_response_time ||
              measure.max_duration > measure.max_total_check_time
            ) {
              setError = true;
            }
          }
          if (setError) {
            touchpoint.relation_steps.forEach(rel => {
              steps_with_error[rel - 1] = 1;
            });
            this.SetTouchpointError(
              touchpoint.stage_index,
              touchpoint.touchpoint_index
            );
          }
        });
      }
    });
    if (count_touchpoints > 0) {
      const porcentage =
        this.GetTotalStepsWithError(steps_with_error) /
        this.stepsByStage[stage - 1];
      if (porcentage >= 0.5) {
        return 'danger';
      }
      if (porcentage >= 0.15) {
        return 'warning';
      }
      return 'good';
    }
    return 'good';
  }

  SetTouchpointError(stage_index, touchpoint_index) {
    this.stages[stage_index - 1].touchpoints.forEach(touchpoint => {
      if (touchpoint.index === touchpoint_index) {
        touchpoint.error = true;
      }
    });
    this.stages[stage_index - 1].steps.forEach(step => {
      step.sub_steps.forEach(sub_step => {
        sub_step.relationship_touchpoints.forEach(value => {
          if (value === touchpoint_index) {
            sub_step.error = true;
          }
        });
      });
    });
  }

  GetTotalStepsWithError(steps_with_error) {
    let count = 0;
    let i = 0;
    while (i < steps_with_error.length) {
      count += steps_with_error[i];
      i++;
    }
    return count;
  }

  LoadCanaryData() {
    return this.dataCanary;
  }

  SetCanaryData(stages, city) {
    this.stages = stages;
    this.city = city;
    this.OffAllTouchpoints();
    this.EnableCanaryTouchPoints();
    this.SetTouchpointsStatus();
    return {
      stages: this.stages
    };
  }

  OffAllTouchpoints() {
    this.touchPoints.some(element => {
      let found = false;
      if (element.index === this.city) {
        element.touchpoints.forEach(tp => {
          tp.status_on_off = false;
        });
        found = true;
      }
      return found;
    });
  }

  EnableCanaryTouchPoints() {
    for (let i = 0; i < this.stages.length; i++) {
      this.stages[i].steps.forEach(step => {
        step.sub_steps.forEach(sub_step => {
          if (sub_step.canary_state === true) {
            sub_step.relationship_touchpoints.forEach(touchPointIndex => {
              this.EnableTouchpoint(i + 1, touchPointIndex);
            });
          }
        });
      });
    }
  }

  EnableTouchpoint(stageIndex, touchPointIndex) {
    this.touchPoints.some(element => {
      let found = false;
      if (element.index === this.city) {
        element.touchpoints.some(tp => {
          let foundTp = false;
          if (
            tp.stage_index === stageIndex &&
            tp.touchpoint_index === touchPointIndex
          ) {
            tp.status_on_off = true;
            foundTp = true;
          }
          return foundTp;
        });
        found = true;
      }
      return found;
    });
  }

  SetTouchpointsStatus() {
    if (this.touchPoints != null) {
      this.touchPoints.forEach(element => {
        if (element.index === this.city) {
          element.touchpoints.forEach(touchpoint => {
            this.UpdateTouchpointStatus(touchpoint);
          });
        }
      });
    }
  }

  UpdateTouchpointStatus(touchpoint) {
    this.stages.some(stage => {
      let found = false;
      if (stage.index === touchpoint.stage_index) {
        stage.touchpoints.some(tp => {
          let foundTp = false;
          if (tp.index === touchpoint.touchpoint_index) {
            tp.status_on_off = touchpoint.status_on_off;
            foundTp = true;
          }
          return foundTp;
        });
        found = true;
      }
      return found;
    });
  }

  ClearCanaryData(stages) {
    this.stages = stages;
    if (this.touchPointsCopy !== null) {
      this.touchPoints = JSON.parse(JSON.stringify(this.touchPointsCopy));
      this.SetTouchpointsStatus();
    }
    return {
      stages: this.stages
    };
  }

  async SetStorageTouchpoints() {
    try {
      this.touchPointsCopy = JSON.parse(JSON.stringify(this.touchPoints));
      const { data } = await AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'touchpoints',
        document: {
          TouchPoints: this.touchPoints
        }
      });
      if (data) {
        this.GetMinPercentageError();
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  GetMinPercentageError() {
    this.minPercentageError = 100;
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        element.touchpoints.forEach(touchpoint => {
          touchpoint.measure_points.forEach(measure => {
            if (measure.type === 0 || measure.type === 20) {
              if (measure.error_threshold < this.minPercentageError) {
                this.minPercentageError = measure.error_threshold;
              }
            }
          });
        });
      }
    });
  }

  SetVersion() {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'version',
        document: {
          Version: this.version
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  async GetStorageTouchpoints() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'touchpoints'
      });
      if (data) {
        this.touchPoints = data.TouchPoints;
        this.touchPointsCopy = JSON.parse(JSON.stringify(this.touchPoints)); // clone the touchpoints with new reference
        this.GetMinPercentageError();
        this.SetTouchpointsStatus();
      } else {
        this.SetStorageTouchpoints();
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  UpdateCanaryData(data) {
    this.SaveCanaryData(data);
  }

  GetCurrentConfigurationJSON() {
    this.ReadPathpointConfig();
    return JSON.stringify(this.configuration, null, 4);
  }

  ReadPathpointConfig() {
    let i = 0;
    let line = 0;
    let kpi = null;
    let multyQuery = null;
    let accountID = this.accountId;
    this.configuration.pathpointVersion = this.version;
    this.configuration.kpis.length = 0;
    for (let i = 0; i < this.kpis.length; i++) {
      accountID = this.accountId;
      if (Reflect.has(this.kpis[i].queryByCity[this.city], 'accountID')) {
        accountID = this.kpis[i].queryByCity[this.city].accountID;
      }
      multyQuery = [
        {
          accountID: accountID,
          query: this.kpis[i].queryByCity[this.city].query,
          link: this.kpis[i].queryByCity[this.city].link
        }
      ];
      kpi = {
        type: this.kpis[i].type,
        name: this.kpis[i].name,
        shortName: this.kpis[i].shortName,
        measure: multyQuery,
        value_type: this.kpis[i].value_type,
        prefix: this.kpis[i].prefix,
        suffix: this.kpis[i].suffix
      };
      this.configuration.kpis.push(kpi);
    }
    this.configuration.stages.length = 0;
    this.stages.forEach(stage => {
      this.configuration.stages.push({
        title: stage.title,
        active_dotted: stage.active_dotted,
        arrowMode: stage.arrowMode,
        percentage_above_avg: stage.percentage_above_avg,
        steps: [],
        touchpoints: []
      });
      i = this.configuration.stages.length;
      line = 0;
      stage.steps.forEach(step => {
        const s_steps = [];
        line++;
        step.sub_steps.forEach(sub_step => {
          s_steps.push({ title: sub_step.value, id: sub_step.id });
        });
        this.configuration.stages[i - 1].steps.push({
          line: line,
          values: s_steps
        });
      });
      stage.touchpoints.forEach(tp => {
        this.configuration.stages[i - 1].touchpoints.push({
          title: tp.value,
          status_on_off: tp.status_on_off,
          dashboard_url: tp.dashboard_url,
          related_steps: this.GetRelatedSteps(tp.stage_index, tp.index),
          queries: this.GetTouchpointQueryes(tp.stage_index, tp.index)
        });
      });
    });
  }

  GetRelatedSteps(stage_index, index) {
    const related_steps = [];
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        element.touchpoints.some(touchpoint => {
          let found = false;
          if (
            touchpoint.stage_index === stage_index &&
            touchpoint.touchpoint_index === index
          ) {
            touchpoint.relation_steps.forEach(value => {
              related_steps.push(value);
            });
            found = true;
          }
          return found;
        });
      }
    });
    return this.GetStepsIds(stage_index, related_steps);
  }

  GetStepsIds(stage_index, related_steps) {
    let relatedIds = '';
    related_steps.forEach(rel_step => {
      this.stages[stage_index - 1].steps.some(step => {
        let found = false;
        step.sub_steps.some(sub_step => {
          if (sub_step.index === rel_step) {
            if (relatedIds !== '') {
              relatedIds += ',';
            }
            relatedIds += sub_step.id;
            found = true;
          }
          return found;
        });
        return found;
      });
    });
    return relatedIds;
  }

  GetTouchpointQueryes(stage_index, index) {
    const queries = [];
    let accountID = this.accountId;
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        element.touchpoints.some(touchpoint => {
          let found = false;
          if (
            touchpoint.stage_index === stage_index &&
            touchpoint.touchpoint_index === index
          ) {
            found = true;
            touchpoint.measure_points.forEach(measure => {
              accountID = this.accountId;
              if (measure.accountID) {
                accountID = measure.accountID;
              }
              if (measure.type === 'PRC') {
                queries.push({
                  type: this.measureNames[0],
                  accountID: accountID,
                  query: measure.query,
                  min_count: measure.min_count
                });
              } else if (measure.type === 'PCC') {
                queries.push({
                  type: this.measureNames[1],
                  accountID: accountID,
                  query: measure.query,
                  min_count: measure.min_count
                });
              } else if (measure.type === 'APP') {
                queries.push({
                  type: this.measureNames[2],
                  accountID: accountID,
                  query: measure.query,
                  min_apdex: measure.min_apdex,
                  max_response_time: measure.max_response_time,
                  max_error_percentage: measure.max_error_percentage
                });
              } else if (measure.type === 'FRT') {
                queries.push({
                  type: this.measureNames[3],
                  accountID: accountID,
                  query: measure.query,
                  min_apdex: measure.min_apdex,
                  max_response_time: measure.max_response_time,
                  max_error_percentage: measure.max_error_percentage
                });
              } else if (measure.type === 'SYN') {
                queries.push({
                  type: this.measureNames[4],
                  accountID: accountID,
                  query: measure.query,
                  max_avg_response_time: measure.max_avg_response_time,
                  max_total_check_time: measure.max_total_check_time,
                  min_success_percentage: measure.min_success_percentage
                });
              } else if (measure.type === 'WLD') {
                queries.push({
                  type: this.measureNames[5],
                  accountID: accountID,
                  query: measure.query
                });
              }
            });
          }
          return found;
        });
      }
    });
    return queries;
  }

  SetConfigurationJSON(configuration) {
    this.configurationJSON = JSON.parse(configuration);
    this.UpdateNewConfiguration();
    this.AddCustomAccountIDs();
    const logRecord = {
      action: 'json-update',
      error: false,
      json_file: configuration
    };
    this.SendToLogs(logRecord);
    return {
      stages: this.stages,
      kpis: this.kpis
    };
  }

  UpdateNewConfiguration() {
    let stageDef = null;
    let sub_stepDef = null;
    let stepDef = null;
    let tpDef = null;
    let tpDef2 = null;
    let measure = null;
    let tpIndex = 1;
    let stageIndex = 1;
    let substepIndex = 1;
    this.stages.length = 0;
    this.touchPoints.length = 0;
    this.kpis = [];
    this.kpis.length = 0;
    this.touchPoints.push({
      index: 0,
      country: 'PRODUCTION',
      touchpoints: []
    });
    let ikpi = null;
    let index = 0;
    let queryByCity = null;
    this.configurationJSON.kpis.forEach(kpi => {
      ikpi = {
        index: index,
        type: kpi.type,
        name: kpi.name,
        shortName: kpi.shortName,
        value_type: kpi.value_type,
        prefix: kpi.prefix,
        suffix: kpi.suffix
      };
      if (kpi.measure[0].accountID !== this.accountId) {
        queryByCity = [
          {
            accountID: kpi.measure[0].accountID,
            query: kpi.measure[0].query,
            link: kpi.link
          }
        ];
      } else {
        queryByCity = [
          {
            query: kpi.measure[0].query,
            link: kpi.link
          }
        ];
      }
      ikpi = { ...ikpi, queryByCity: queryByCity };
      index++;
      if (kpi.type === 100) {
        ikpi = { ...ikpi, value: 0 };
      } else {
        ikpi = {
          ...ikpi,
          value: {
            current: 0,
            previous: 0
          }
        };
      }
      if (index < 4) {
        ikpi = { ...ikpi, check: true };
      }
      this.kpis.push(ikpi);
    });
    this.configurationJSON.stages.forEach(stage => {
      stageDef = {
        index: stageIndex,
        title: stage.title,
        latencyStatus: false,
        status_color: 'good',
        gout_enable: false,
        gout_quantity: 150,
        gout_money: 250,
        money_enabled: false,
        trafficIconType: 'traffic',
        money: '',
        icon_active: 0,
        icon_description: 'star',
        icon_visible: false,
        congestion: {
          value: 0,
          percentage: 0
        },
        capacity: 0,
        total_count: 0,
        active_dotted: stage.active_dotted,
        active_dotted_color: '#828282',
        arrowMode: stage.arrowMode,
        percentage_above_avg: stage.percentage_above_avg,
        steps: [],
        touchpoints: []
      };
      substepIndex = 1;
      stage.steps.forEach(step => {
        stepDef = {
          value: '',
          sub_steps: []
        };
        step.values.forEach(sub_step => {
          sub_stepDef = {
            index: substepIndex,
            id: sub_step.id,
            canary_state: false,
            latency: true,
            value: sub_step.title,
            dark: false,
            sixth_sense: false,
            history_error: false,
            dotted: false,
            highlighted: false,
            error: false,
            index_stage: stageIndex,
            relationship_touchpoints: []
          };
          stepDef.sub_steps.push(sub_stepDef);
          substepIndex++;
        });
        stageDef.steps.push(stepDef);
      });
      stage.touchpoints.forEach(tp => {
        tpDef = {
          index: tpIndex,
          stage_index: stageIndex,
          status_on_off: tp.status_on_off,
          active: false,
          value: tp.title,
          highlighted: false,
          error: false,
          history_error: false,
          sixth_sense: false,
          sixth_sense_url: [[]],
          countrys: [0],
          dashboard_url: tp.dashboard_url,
          relation_steps: tp.related_steps.split(',')
        };
        tpDef2 = {
          stage_index: stageIndex,
          value: tp.title,
          touchpoint_index: tpIndex,
          status_on_off: tp.status_on_off,
          relation_steps: tp.related_steps.split(','),
          measure_points: []
        };
        tp.queries.forEach(query => {
          if (query.type === this.measureNames[0]) {
            measure = {
              type: 'PRC',
              query: query.query,
              min_count: query.min_count,
              session_count: 0
            };
          } else if (query.type === this.measureNames[1]) {
            measure = {
              type: 'PCC',
              query: query.query,
              min_count: query.min_count,
              transaction_count: 0
            };
          } else if (query.type === this.measureNames[2]) {
            measure = {
              type: 'APP',
              query: query.query,
              min_apdex: query.min_apdex,
              max_response_time: query.max_response_time,
              max_error_percentage: query.max_error_percentage,
              apdex_value: 0,
              response_value: 0,
              error_percentage: 0
            };
          } else if (query.type === this.measureNames[3]) {
            measure = {
              type: 'FRT',
              query: query.query,
              min_apdex: query.min_apdex,
              max_response_time: query.max_response_time,
              max_error_percentage: query.max_error_percentage,
              apdex_value: 0,
              response_value: 0,
              error_percentage: 0
            };
          } else if (query.type === this.measureNames[4]) {
            measure = {
              type: 'SYN',
              query: query.query,
              max_avg_response_time: query.max_avg_response_time,
              max_total_check_time: query.max_total_check_time,
              min_success_percentage: query.min_success_percentage,
              success_percentage: 0,
              max_duration: 0,
              max_request_time: 0
            };
          } else if (query.type === this.measureNames[5]) {
            measure = {
              type: 'WLD',
              query: query.query,
              status_value: 'NO-VALUE'
            };
          }
          if (query.accountID !== this.accountId) {
            measure = { accountID: query.accountID, ...measure };
          }
          tpDef2.measure_points.push(measure);
        });
        stageDef.touchpoints.push(tpDef);
        this.touchPoints[0].touchpoints.push(tpDef2);
        tpIndex++;
      });
      this.stages.push(stageDef);
      stageIndex++;
      tpIndex = 1;
    });
    this.UpdateTouchpointsRelationship();
    this.SetInitialDataViewToStorage();
    this.SetInitialDataTouchpointsToStorage();
    this.UpdateTouchpointCopy();
  }

  UpdateTouchpointsRelationship() {
    this.touchPoints[0].touchpoints.forEach(touchpoint => {
      const indexList = [];
      touchpoint.relation_steps.forEach(value => {
        indexList.push(this.GetIndexStep(touchpoint.stage_index, value));
      });
      touchpoint.relation_steps = indexList;
    });
    this.stages.forEach(stage => {
      stage.touchpoints.forEach(touchpoint => {
        const indexList = [];
        touchpoint.relation_steps.forEach(value => {
          indexList.push(this.GetIndexStep(touchpoint.stage_index, value));
        });
        touchpoint.relation_steps = indexList;
        this.SetStepsRelationship(
          touchpoint.stage_index,
          indexList,
          touchpoint.index
        );
      });
    });
  }

  GetIndexStep(stage_index, stepId) {
    let index = 0;
    this.stages[stage_index - 1].steps.some(step => {
      let found = false;
      step.sub_steps.some(sub_step => {
        if (sub_step.id === stepId) {
          index = sub_step.index;
          found = true;
        }
        return found;
      });
      return found;
    });
    return index;
  }

  SetStepsRelationship(stage_index, indexList, touchpoint_index) {
    for (let i = 0; i < indexList.length; i++) {
      this.stages[stage_index - 1].steps.some(step => {
        let found = false;
        step.sub_steps.some(sub_step => {
          if (sub_step.index === indexList[i]) {
            sub_step.relationship_touchpoints.push(touchpoint_index);
            found = true;
          }
          return found;
        });
        return found;
      });
    }
  }

  SetInitialDataTouchpointsToStorage() {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'touchpoints',
        document: {
          TouchPoints: this.touchPoints
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  UpdateTouchpointCopy() {
    this.touchPointsCopy = JSON.parse(JSON.stringify(this.touchPoints));
  }

  GetCurrentHistoricErrorScript() {
    const data = historicErrorScript();
    const pathpointId = `var pathpointId = "${this.pathpointId}"`;
    const response = `${pathpointId}${data.header
      }${this.CreateNrqlQueriesForHistoricErrorScript()}${data.footer}`;
    return response;
  }

  async ReadHistoricErrors() {
    const query = `SELECT count(*) FROM PathpointHistoricErrors WHERE pathpoint_id=${this.pathpointId} percentage>${this.minPercentageError} FACET stage_index,touchpoint_index,percentage LIMIT MAX SINCE ${this.historicErrorsHours} hours ago`;
    const gql = `{
        actor { account(id: ${this.accountId}) {
            nrql(query: "${query}", timeout: 10) {
                results
            }
        }}}`;
    const { data, error } = await NerdGraphQuery.query({ query: gql });
    if (error) {
      throw new Error(error);
    }
    if (data && data.actor.account.nrql != null) {
      this.CalculateHistoricErrors(data.actor.account.nrql);
    }
    return {
      stages: this.stages
    };
  }

  CalculateHistoricErrors(nrql) {
    const results = nrql.results;
    let key = '';
    const historicErrors = {};
    let errorLength = 0;
    for (let i = 0; i < results.length; i++) {
      key = `tp_${results[i].facet[0]}_${results[i].facet[1]}`;
      if (
        results[i].facet[2] >=
        this.GetTouchpointErrorThreshold(
          results[i].facet[0],
          results[i].facet[1]
        )
      ) {
        if (!(key in historicErrors)) {
          errorLength++;
          historicErrors[key] = results[i].count;
        } else {
          historicErrors[key] += results[i].count;
        }
      }
    }
    const sortable = Object.fromEntries(
      Object.entries(historicErrors).sort(([, a], [, b]) => b - a)
    );
    const NumOfErrorsToShow = Math.round(
      (this.historicErrorsHighLightPercentage * errorLength) / 100
    );
    let count = 0;
    this.ClearTouchpointHistoricError();
    for (const [key] of Object.entries(sortable)) {
      count++;
      if (count <= NumOfErrorsToShow) {
        const c = key.split('_');
        this.SetTouchpointHistoricError(c[1], c[2]);
      }
    }
  }

  SetTouchpointHistoricError(stage_index, touchpoint_index) {
    this.stages.some(stage => {
      let found1 = false;
      if (
        !isNaN(parseInt(stage_index)) &&
        stage.index === parseInt(stage_index)
      ) {
        stage.touchpoints.some(touchpoint => {
          let found2 = false;
          if (
            !isNaN(parseInt(touchpoint_index)) &&
            touchpoint.index === parseInt(touchpoint_index)
          ) {
            touchpoint.history_error = true;
            found2 = true;
          }
          return found2;
        });
        found1 = true;
      }
      return found1;
    });
  }

  ClearTouchpointHistoricError() {
    this.stages.forEach(stage => {
      stage.touchpoints.forEach(touchpoint => {
        touchpoint.history_error = false;
      });
    });
  }

  GetTouchpointErrorThreshold(stage_index, touchpoint_index) {
    let value = 0;
    this.touchPoints.some(element => {
      let found1 = false;
      if (element.index === this.city) {
        element.touchpoints.some(touchpoint => {
          let found2 = false;
          if (
            touchpoint.stage_index === stage_index &&
            touchpoint.touchpoint_index === touchpoint_index
          ) {
            touchpoint.measure_points.some(measure => {
              let found3 = false;
              if (measure.type === 0 || measure.type === 20) {
                value = measure.error_threshold;
                found3 = true;
              }
              return found3;
            });
            found2 = true;
          }
          return found2;
        });
        found1 = true;
      }
      return found1;
    });
    return value;
  }

  CreateNrqlQueriesForHistoricErrorScript() {
    let data = 'var raw1 = JSON.stringify({"query":"{ actor {';
    let i = 0;
    let n = 1;
    let query = '';
    let query2 = '';
    const countBreak = 20;
    this.touchPoints.forEach(element => {
      if (element.index === this.city) {
        element.touchpoints.forEach(touchpoint => {
          data +=
            ' measure_' +
            touchpoint.stage_index +
            '_' +
            touchpoint.touchpoint_index +
            '_' +
            touchpoint.measure_points[0].type +
            ': account(id: "+myAccountID+") { nrql(query: \\"';
          if (touchpoint.measure_points[0].type === 20) {
            query2 = touchpoint.measure_points[0].query;
          } else {
            query = touchpoint.measure_points[0].query.split(' ');
            query2 =
              'SELECT count(*), percentage(count(*), WHERE error is true) as percentage';
            for (let wi = 2; wi < query.length; wi++) {
              query2 += ' ' + query[wi];
            }
          }
          data += query2;
          data += ' SINCE 5 minutes AGO';
          data += '\\", timeout: 10) {results }}';
          i++;
          if (i === countBreak) {
            i = 0;
            data += '}}","variables":""});';
            data += `
`;
            n++;
            data += 'var raw' + n + ' = JSON.stringify({"query":"{ actor {';
          }
        });
        data += '}}","variables":""});';
        data += `
`;
      }
    });
    for (let w = 1; w <= n; w++) {
      data +=
        `
var graphqlpack` +
        w +
        ` = {
headers: {
    "Content-Type": "application/json",
    "API-Key": graphQLKey
},
url: 'https://api.newrelic.com/graphql',
body: raw` +
        w +
        `
};

var return` +
        w +
        ` = null;

`;
    }
    for (let w = 1; w < n; w++) {
      data +=
        `
function callback` +
        w +
        `(err, response, body) {
return` +
        w +
        ` = JSON.parse(body);
$http.post(graphqlpack` +
        (w + 1) +
        `, callback` +
        (w + 1) +
        `);
} 

`;
    }
    data +=
      `
function callback` +
      n +
      `(err, response, body) {
return` +
      n +
      ` = JSON.parse(body);
var events = [];
var event = null;
var c = null;
`;
    for (let w = 1; w <= n; w++) {
      data +=
        `
for (const [key, value] of Object.entries(return` +
        w +
        `.data.actor)) {
    c = key.split("_");
    if (value.nrql.results != null) {
        if(c[3]=='0'){
            event = {
                "eventType": "PathpointHistoricErrors",
                "pathpointId": pathpointId,
                "stage_index": parseInt(c[1]),
                "touchpoint_index": parseInt(c[2]),
                "count": value.nrql.results[0].count,
                "percentage": value.nrql.results[0].percentage
            }
        }else{
            event = {
                "eventType": "PathpointHistoricErrors",
                "pathpointId": pathpointId,
                "stage_index": parseInt(c[1]),
                "touchpoint_index": parseInt(c[2]),
                "count": value.nrql.results[0].R1,
                "percentage": value.nrql.results[0].R2
            }
        }
        
        console.log(event);
        events.push(event);
    }
}

`;
    }
    return data;
  }

  UpdateTouchpointOnOff(touchpoint, updateStorage) {
    this.touchPoints.some(element => {
      let found = false;
      if (element.index === this.city) {
        found = true;
        element.touchpoints.some(tp => {
          let found2 = false;
          if (
            tp.stage_index === touchpoint.stage_index &&
            tp.touchpoint_index === touchpoint.index
          ) {
            found2 = true;
            const logRecord = {
              action: 'touchpoint-enable-disable',
              error: false,
              touchpoint_name: touchpoint.value,
              touchpoint_type: tp.measure_points[0].type,
              stage_name: this.stages[tp.stage_index - 1].title,
              touchpoint_enabled: touchpoint.status_on_off
            };
            this.SendToLogs(logRecord);
            tp.status_on_off = touchpoint.status_on_off;
            if (updateStorage) {
              this.SetStorageTouchpoints();
            }
          }
          return found2;
        });
      }
      return found;
    });
  }

  GetTouchpointTune(touchpoint) {
    let datos = null;
    this.touchPoints.some(element => {
      let found1 = false;
      if (element.index === this.city) {
        found1 = true;
        element.touchpoints.some(tp => {
          let found2 = false;
          if (
            tp.stage_index === touchpoint.stage_index &&
            tp.touchpoint_index === touchpoint.index
          ) {
            found2 = true;
            datos = tp.measure_points;
          }
          return found2;
        });
      }
      return found1;
    });
    return datos;
  }

  GetTouchpointQuerys(touchpoint) {
    const datos = [];
    let accountID = this.accountId;
    this.touchPoints.some(element => {
      let found1 = false;
      if (element.index === this.city) {
        found1 = true;
        element.touchpoints.some(tp => {
          let found2 = false;
          if (
            tp.stage_index === touchpoint.stage_index &&
            tp.touchpoint_index === touchpoint.index
          ) {
            found2 = true;
            let actualValue = 0;
            tp.measure_points.forEach(measure => {
              accountID = this.accountId;
              if (measure.accountID) {
                accountID = measure.accountID;
              }
              if (measure.type === 'PRC') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[0],
                  value: actualValue,
                  type: 'PRC',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: this.ValidateMeasureTime(measure)
                });
              } else if (measure.type === 'PCC') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[1],
                  value: actualValue,
                  type: 'PCC',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: this.ValidateMeasureTime(measure)
                });
              } else if (measure.type === 'APP') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[2],
                  value: actualValue,
                  type: 'APP',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: this.ValidateMeasureTime(measure)
                });
              } else if (measure.type === 'FRT') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[3],
                  value: actualValue,
                  type: 'FRT',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: this.ValidateMeasureTime(measure)
                });
              } else if (measure.type === 'SYN') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[4],
                  value: actualValue,
                  type: 'SYN',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: this.ValidateMeasureTime(measure)
                });
              } else if (measure.type === 'WLD') {
                datos.push({
                  accountID: accountID,
                  label: this.measureNames[5],
                  value: actualValue,
                  type: 'WLD',
                  query_start: '',
                  query_body: measure.query,
                  query_footer: ''
                });
              }
              actualValue++;
            });
          }
          return found2;
        });
      }
      return found1;
    });
    return datos;
  }

  ValidateMeasureTime(measure) {
    if (measure.measure_time) {
      return `SINCE ${measure.measure_time}`;
    }
    return `SINCE ${this.TimeRangeTransform(this.timeRange, false)}`;
  }

  UpdateTouchpointTune(touchpoint, datos) {
    this.touchPoints.some(element => {
      let found = false;
      if (element.index === this.city) {
        found = true;
        element.touchpoints.some(tp => {
          let found2 = false;
          if (
            tp.stage_index === touchpoint.stage_index &&
            tp.touchpoint_index === touchpoint.index
          ) {
            found2 = true;
            const logRecord = {
              action: 'touchpoint-tune',
              message: datos,
              error: false,
              touchpoint_name: touchpoint.value,
              touchpoint_type: tp.measure_points[0].type,
              stage_name: this.stages[tp.stage_index - 1].title,
              touchpoint_enabled: touchpoint.status_on_off
            };
            this.SendToLogs(logRecord);
            switch (tp.measure_points[0].type) {
              case 'PRC':
              case 'PCC':
                tp.measure_points[0].min_count = datos.min_count;
                break;
              case 'APP':
              case 'FRT':
                tp.measure_points[0].min_apdex = datos.min_apdex;
                tp.measure_points[0].max_response_time =
                  datos.max_response_time;
                tp.measure_points[0].max_error_percentage =
                  datos.max_error_percentage;
                break;
              case 'SYN':
                tp.measure_points[0].max_avg_response_time =
                  datos.max_avg_response_time;
                tp.measure_points[0].max_total_check_time =
                  datos.max_total_check_time;
                tp.measure_points[0].min_success_percentage =
                  datos.min_success_percentage;
                break;
            }
            this.SetStorageTouchpoints();
          }
          return found2;
        });
      }
      return found;
    });
  }

  UpdateTouchpointQuerys(touchpoint, datos) {
    this.touchPoints.some(element => {
      let found = false;
      if (element.index === this.city) {
        found = true;
        element.touchpoints.some(tp => {
          let found2 = false;
          if (
            tp.stage_index === touchpoint.stage_index &&
            tp.touchpoint_index === touchpoint.index
          ) {
            found2 = true;
            const logRecord = {
              action: 'touchpoint-update',
              message: datos,
              account_id: datos[0].accountID,
              query: datos[0].query_body,
              error: false,
              touchpoint_name: touchpoint.value,
              touchpoint_type: tp.measure_points[0].type,
              stage_name: this.stages[tp.stage_index - 1].title,
              touchpoint_enabled: touchpoint.status_on_off
            };
            this.SendToLogs(logRecord);
            datos.forEach(dato => {
              this.UpdateMeasure(dato, tp.measure_points);
            });
            this.SetStorageTouchpoints();
          }
          return found2;
        });
      }
      return found;
    });
  }

  UpdateMeasure(data, measure_points) {
    measure_points.some(measure => {
      let found = false;
      if (measure.type === data.type) {
        found = true;
        if (data.accountID !== this.accountId) {
          measure.accountID = data.accountID;
        }
        measure.query = data.query_body;
      }
      return found;
    });
  }

  UpdateGoutParameters(dropForm) {
    this.dropParams = dropForm;
    this.setStorageDropParams();
  }

  GetGoutParameters() {
    return this.dropParams;
  }

  setStorageDropParams() {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'DropParams',
        document: {
          dropParams: this.dropParams
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  async GetStorageDropParams() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'DropParams'
      });
      if (data) {
        this.dropParams = data.dropParams;
      } else {
        this.dropParams = {
          dropmoney: 100,
          hours: 48,
          percentage: 30
        };
      }
    } catch (error) {
      throw new Error(error);
    }
  }

  GetHistoricParameters() {
    const values = { hours: 0, percentage: 0 };
    values.hours = this.historicErrorsHours;
    values.percentage = this.historicErrorsHighLightPercentage;
    return values;
  }

  UpdateHistoricParameters(hours, percentage) {
    this.historicErrorsHours = hours;
    this.historicErrorsHighLightPercentage = percentage;
    this.SetStorageHistoricErrorsParams();
  }

  SetStorageHistoricErrorsParams() {
    try {
      AccountStorageMutation.mutate({
        accountId: this.accountId,
        actionType: AccountStorageMutation.ACTION_TYPE.WRITE_DOCUMENT,
        collection: 'pathpoint',
        documentId: 'HistoricErrorsParams',
        document: {
          historicErrorsHours: this.historicErrorsHours,
          historicErrorsHighLightPercentage: this
            .historicErrorsHighLightPercentage
        }
      });
    } catch (error) {
      throw new Error(error);
    }
  }

  async GetStorageHistoricErrorsParams() {
    try {
      const { data } = await AccountStorageQuery.query({
        accountId: this.accountId,
        collection: 'pathpoint',
        documentId: 'HistoricErrorsParams'
      });
      if (data) {
        this.historicErrorsHours = data.historicErrorsHours;
        this.historicErrorsHighLightPercentage =
          data.historicErrorsHighLightPercentage;
      }
    } catch (error) {
      throw new Error(error);
    }
  }
}

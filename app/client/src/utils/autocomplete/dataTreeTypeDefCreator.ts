import { DataTree, ENTITY_TYPE } from "entities/DataTree/dataTreeFactory";
import _ from "lodash";
import { generateReactKey } from "utils/generators";
import {
  entityDefinitions,
  GLOBAL_DEFS,
  GLOBAL_FUNCTIONS,
} from "utils/autocomplete/EntityDefinitions";
import { getType, Types } from "utils/TypeHelpers";

let extraDefs: any = {};
const skipProperties = ["!doc", "!url"];

export const dataTreeTypeDefCreator = (dataTree: DataTree) => {
  const def: any = {
    "!name": "dataTree",
  };
  Object.keys(dataTree).forEach((entityName) => {
    const entity = dataTree[entityName];
    if (entity && "ENTITY_TYPE" in entity) {
      if (entity.ENTITY_TYPE === ENTITY_TYPE.WIDGET) {
        const widgetType = entity.type;
        if (widgetType in entityDefinitions) {
          const definition = _.get(entityDefinitions, widgetType);
          if (_.isFunction(definition)) {
            const data = definition(entity);
            Object.keys(data).forEach((item: any) => {
              if (!skipProperties.includes(item)) {
                def[entityName + "." + item] = entityName + "." + item;
              }
            });
            def[entityName] = entityName + "." + definition(entity);
          }
        }
      }
      if (entity.ENTITY_TYPE === ENTITY_TYPE.ACTION) {
        const actionDefs = entityDefinitions.ACTION(entity);
        def[entityName] = actionDefs;
        Object.keys(actionDefs).forEach((item: any) => {
          if (!skipProperties.includes(item)) {
            def[entityName + "." + item] = entityName + "." + item;
          }
        });
      }
      if (entity.ENTITY_TYPE === ENTITY_TYPE.APPSMITH) {
        const options: any = generateTypeDef(_.omit(entity, "ENTITY_TYPE"));
        def.appsmith = options;
        const flattenedObjects = flattenObjKeys(options, "appsmith");
        flattenedObjects.forEach((option: string) => {
          def[option] = option;
        });
      }
    }
  });
  def["!define"] = { ...GLOBAL_DEFS, ...extraDefs };
  extraDefs = {};
  return { ...def, ...GLOBAL_FUNCTIONS };
};

export function generateTypeDef(
  obj: any,
): string | Record<string, string | Record<string, unknown>> {
  const type = getType(obj);
  switch (type) {
    case Types.ARRAY: {
      const arrayType = generateTypeDef(obj[0]);
      const name = generateReactKey();
      extraDefs[name] = arrayType;
      return `[${name}]`;
    }
    case Types.OBJECT: {
      const objType: Record<string, string | Record<string, unknown>> = {};
      Object.keys(obj).forEach((k) => {
        objType[k] = generateTypeDef(obj[k]);
      });
      return objType;
    }
    case Types.STRING:
      return "string";
    case Types.NUMBER:
      return "number";
    case Types.BOOLEAN:
      return "bool";
    case Types.NULL:
    case Types.UNDEFINED:
      return "?";
    default:
      return "?";
  }
}

export const flattenObjKeys = (
  options: any,
  parentKey: string,
  results: Array<string> = [],
): Array<string> => {
  const r: Array<string> = results;
  for (const [key, value] of Object.entries(options)) {
    if (_.isObject(value)) {
      flattenObjKeys(value, parentKey + "." + key, r);
    }
    r.push(parentKey + "." + key);
  }
  return r;
};

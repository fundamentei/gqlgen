#!/usr/bin/env node

const path = require("path");
const yargs = require("yargs");
const graphql = require("graphql");
const graphqlLanguage = require("graphql/language");
const { parse: parseSchema, getIntrospectionQuery, buildClientSchema, printSchema } = require("graphql");
const { existsSync, writeFileSync } = require("fs");
const fetch = require("node-fetch");
const prettier = require("prettier");

async function main() {
  yargs
    .command(
      "$0 <url> <filter>",
      "Generates a list of all queries and mutations available from the provided GraphQL schema",
      (yargs) => {
        yargs.positional("url", {
          type: "string",
          describe: "GraphQL endpoint URL",
        });

        yargs.positional("filter", {
          type: "string",
          choices: ["query", "mutation"],
        });
      },
      /**
       * Handles the command execution with the provided arguments
       * @param {{url: string, filter: "query" | "mutation"}} argv
       */
      async (argv) => {
        // TODO: implement URL validation?
        const schema = await fetchSchemaWithIntrospection(argv.url);
        const { operations } = findOperationsAndTypes(schema);

        const queries = operations.filter((operation) => operation.kind === "query");
        const mutations = operations.filter((operation) => operation.kind === "mutation");

        if (argv.filter === "query") {
          queries.forEach((query) => {
            console.log(query.name);
          });
        }
        if (argv.filter === "mutation") {
          mutations.forEach((mutation) => {
            console.log(mutation.name);
          });
        }
      }
    )
    .command(
      "generate <url> <type> [operations...]",
      "Generates the code for the specified list of operations",
      (yargs) => {
        yargs.positional("url", {
          type: "string",
          describe: "GraphQL endpoint URL",
        });

        yargs.positional("type", {
          type: "string",
          choices: ["query", "mutation"],
        });

        yargs.option("operations", {
          type: "array",
        });

        yargs.option("write", {
          type: "boolean",
          describe: `Writes the generated code to the filesystem`,
        });
      },
      /**
       * Handles the code generation for the provided list of operations
       * @param {{url: string, type: "query" | "mutation", operations: string[], write?: boolean}} argv
       */
      async (argv) => {
        const upperFirst = (input) => input.charAt(0).toUpperCase() + input.slice(1);

        if (argv.operations.length === 0) {
          return;
        }

        const schema = await fetchSchemaWithIntrospection(argv.url);
        const { operations, types } = findOperationsAndTypes(schema);

        const nodes = operations
          .filter((operation) => {
            return operation.kind === argv.type && argv.operations.includes(operation.name);
          })
          .map((operation) => {
            const name = `${upperFirst(operation.name)}${upperFirst(operation.kind)}`;

            return {
              name,
              fileName: `${name}.ts`,
              code: generateCodeForOperation(operation, types),
            };
          });

        if (argv.write) {
          const isSafeToWrite = nodes.every(({ fileName }) => {
            return !existsSync(fileName);
          });

          if (isSafeToWrite) {
            nodes.forEach(({ fileName, code }) => {
              writeFileSync(fileName, code);
              console.log("Written to %s", fileName);
            });
          }
        } else {
          nodes.forEach(({ fileName, code }) => {
            console.log(`// ${fileName}`);
            process.stdout.write(code);
          });
        }
      }
    )
    .demandCommand()
    .help().argv;
}

/**
 * Fetches and build the schema from the specified URL by running a GraphQL introspection query
 * @param {string} url
 */
async function fetchSchemaWithIntrospection(url) {
  const introspectionQuery = getIntrospectionQuery();
  const response = await fetch("http://localhost:25202/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: introspectionQuery }),
  });
  const { data } = await response.json();
  const clientSchema = buildClientSchema(data);
  const parsedSchema = parseSchema(printSchema(clientSchema));
  return parsedSchema;
}

/**
 * Finds all available GraphQL operations and types from the schema
 * @param {graphql.DocumentNode} schema
 */
function findOperationsAndTypes(schema) {
  /**
   * Holds a list of all available operations (Query, Mutation) in the schema
   * @type {{kind: "query" | "mutation", name: string, astValue: graphql.FieldDefinitionNode}[]}
   */
  const operations = [];
  /**
   * @type {Map<string, graphql.FieldDefinitionNode[]>>}
   */
  const types = new Map();

  graphqlLanguage.visit(schema, {
    ObjectTypeDefinition: (node) => {
      const isQueryOrMutation = node.name.value === "Mutation" || node.name.value === "Query";

      if (isQueryOrMutation) {
        const kind = node.name.value === "Mutation" ? "mutation" : "query";
        node.fields.forEach((field) => {
          operations.push({
            kind,
            name: field.name.value,
            astValue: field,
          });
        });
        return;
      }

      types.set(node.name.value, node.fields || []);
    },
  });

  return {
    operations,
    types,
  };
}

/**
 * Generates the GraphQL query code for the provided operation
 *
 * @param {{kind: "query" | "mutation", name: string, astValue: graphql.FieldDefinitionNode}} operation
 * @param {Map<string, graphql.FieldDefinitionNode[]>} types
 * @param {number} maxFieldsSelectionDepth
 */
function generateCodeForOperation(operation, types, maxFieldsSelectionDepth = 2) {
  const upperFirst = (input) => input.charAt(0).toUpperCase() + input.slice(1);

  const code = [];

  // code.push(`// ${upperFirst(operation.name)}${upperFirst(operation.kind)}.ts`);
  code.push(`import gql from "graphql-tag";`);

  code.push("");
  code.push("export default gql`");
  code.push(`${operation.kind} ${upperFirst(operation.name)}`);

  // Arguments
  if (operation.astValue.arguments && operation.astValue.arguments.length > 0) {
    // Start arguments
    code.push("(");

    code.push(
      operation.astValue.arguments
        .map((arg) => {
          return `$${arg.name.value}: ${getTypeName(arg.type, true)}`;
        })
        .join(",")
    );

    // End arguments
    code.push(")");
  }

  // Operation execution selection
  code.push("{");

  // Operation name
  code.push(operation.name);

  // Arguments usage
  if (operation.astValue.arguments && operation.astValue.arguments.length > 0) {
    // Start arguments
    code.push("(");

    code.push(
      operation.astValue.arguments
        .map((arg) => {
          return `${arg.name.value}: $${arg.name.value}`;
        })
        .join(",")
    );

    // End arguments
    code.push(")");
  }
  // End arguments usage

  // Fields selection
  const returnType = getTypeName(operation.astValue.type, false);

  if (types.has(returnType)) {
    const selectFields = (types, field, code, depth = 0) => {
      const fieldType = getTypeName(field.type, false);
      const fieldName = field.name.value;

      if (!types.has(fieldType)) {
        code.push(fieldName);
        return;
      }

      code.push(fieldName);

      if (depth < maxFieldsSelectionDepth) {
        // Start fields selection
        code.push("{");

        types.get(fieldType).forEach((item) => {
          selectFields(types, item, code, depth + 1);
        });

        // End fields selection
        code.push("}");
      }
    };

    // Start fields selection
    code.push("{");

    types.get(returnType).forEach((field) => {
      selectFields(types, field, code);
    });

    // End fields selection
    code.push("}");
  }

  // End operation execution
  code.push("}");

  code.push("`");
  code.push("");

  return prettier.format(code.join("\n"), {
    parser: "typescript",
  });
}

/**
 * Returns the underlying node type name
 * @param {graphql.TypeNode} node
 */
function getTypeName(node, forQueryDefinition = false) {
  if (forQueryDefinition) {
    if (node.kind === "NonNullType") {
      return `${getTypeName(node.type, forQueryDefinition)}!`;
    }
    if (node.kind === "ListType") {
      return `[${getTypeName(node.type, forQueryDefinition)}]`;
    }
  }

  if (node.kind === "NonNullType") {
    return getTypeName(node.type, forQueryDefinition);
  }
  if (node.kind === "ListType") {
    return getTypeName(node.type, forQueryDefinition);
  }
  if (node.kind === "NamedType") {
    return node.name.value;
  }
  return "";
}

main();

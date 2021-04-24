## `gqlgen`

A cli script to easily generate GraphQL queries/mutations for your frontend.

### Grab a list of all queries or mutations

```SH
$ npx --quiet github:fundamentei/gqlgen http://localhost:25202/ query
```

> Whereas **query** could be either **query** itself or **mutation** for listing only mutation operations.

### Generate queries for operations

```SH
$ npx --quiet github:fundamentei/gqlgen generate http://localhost:25202/ query now
```

This will print the following code:

```TS
// NowQuery.ts
import gql from "graphql-tag";

export default gql`
  query Now {
    now
  }
`;
```

If you pass `--write` flag it will write the file to the working directory. For example:

```SH
$ npx --quiet github:fundamentei/gqlgen generate http://localhost:25202/ --write query now
```

### Usage with [FZF](https://github.com/junegunn/fzf) (Provides the best DX)

```
$ npx --quiet github:fundamentei/gqlgen http://localhost:25202 query |fzf --reverse --multi |xargs npx --quiet github:fundamentei/gqlgen generate http://localhost:25202 query
```

The command above will prompt you to select a list of all available queries to generate code for.

> **Bonus**: you can even create a **package.json** script with the command above so you can easily run it from your app repository. 🤭

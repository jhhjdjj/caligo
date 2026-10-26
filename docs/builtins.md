# Builtins

Caligo ships with a small standard library. Every function is a plain value, so you
can pass it around like any other function:

```caligo
let shout = upper
print(map(["hi", "there"], shout))
```

This page is generated from the source with `npm run docs:builtins`.

| Signature | Description |
| --- | --- |
| `abs(number) -> number` | Absolute value. |
| `all(list, fn) -> bool` | True when `fn(item)` is truthy for every item. |
| `any(list, fn) -> bool` | True when `fn(item)` is truthy for at least one item. |
| `append(list, ...values) -> list` | Return a new list with the values appended. |
| `assert(condition, message?)` | Fail with `message` when `condition` is falsy. |
| `bool(value) -> bool` | Return the truthiness of a value. Only `nil` and `false` are falsy. |
| `ceil(number) -> number` | Round up. |
| `concat(first, second)` | Join two lists or two strings. |
| `contains(collection, needle) -> bool` | Check whether a string contains a substring, or a list contains a value. |
| `each(list, fn)` | Call `fn(item)` for its side effects and return `nil`. |
| `endsWith(text, suffix) -> bool` | Check whether a string ends with a suffix. |
| `filter(list, fn) -> list` | Keep the items for which `fn(item)` is truthy. |
| `find(list, fn)` | Return the first item for which `fn(item)` is truthy, or `nil`. |
| `floor(number) -> number` | Round down. |
| `fromJson(text)` | Parse a JSON string into lists, maps and scalar values. |
| `get(map, key, default?)` | Read a key from a map, returning `default` (or `nil`) when it is missing. |
| `has(map, key) -> bool` | Check whether a map contains a key. |
| `join(list, separator) -> string` | Join a list of strings with a separator. |
| `keys(map) -> list` | Return the keys of a map as a list. |
| `len(value) -> number` | Length of a string (in characters), list, or map. |
| `lower(text) -> string` | Convert a string to lower case. |
| `map(list, fn) -> list` | Return a new list containing `fn(item)` for every item. |
| `max(...values) -> number` | Largest of the arguments. `max(list)` also works with a single list. |
| `merge(map, other) -> map` | Return a shallow merge of two maps; keys in `other` win. |
| `min(...values) -> number` | Smallest of the arguments. `min(list)` also works with a single list. |
| `num(value) -> number` | Convert a string or number to a number. `num("2.5")` is `2.5`. |
| `pow(base, exponent) -> number` | Raise `base` to the power of `exponent`. |
| `print(...values)` | Print the values on one line, separated by spaces. |
| `put(map, key, value) -> map` | Return a copy of the map with one key set. |
| `range(start, end?) -> list` | Build a list of integers: `range(4)` is `[0, 1, 2, 3]`, `range(2, 5)` is `[2, 3, 4]`. |
| `reduce(list, initial, fn)` | Fold a list into one value: `reduce(list, 0, fn(acc, item) { acc + item })`. |
| `repeat(text, times) -> string` | Repeat a string `times` times. |
| `replace(text, search, replacement) -> string` | Replace every occurrence of `search` with `replacement`. |
| `reverse(value)` | Reverse a list or a string. |
| `round(number) -> number` | Round to the nearest integer. |
| `setAt(list, index, value) -> list` | Return a copy of the list with one item replaced. |
| `slice(value, start, end?)` | Take a section of a list or string. Negative indexes count from the end. |
| `sort(list, fn?) -> list` | Return a sorted copy. Pass a comparator `fn(a, b)` returning a number for custom ordering. |
| `split(text, separator) -> list` | Split a string on a separator. An empty separator splits into characters: `split("abc", "")`. |
| `sqrt(number) -> number` | Square root. |
| `startsWith(text, prefix) -> bool` | Check whether a string starts with a prefix. |
| `str(value) -> string` | Convert any value to its display string. |
| `sum(list) -> number` | Add up a list of numbers. |
| `toJson(value) -> string` | Serialize a value to a compact JSON string. |
| `trim(text) -> string` | Remove whitespace from both ends of a string. |
| `type(value) -> string` | Return the type name: "nil", "bool", "number", "string", "list", "map" or "function". |
| `upper(text) -> string` | Convert a string to upper case. |
| `values(map) -> list` | Return the values of a map as a list. |

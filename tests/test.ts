import test from "node:test";
import assert from "node:assert/strict";
import prettier from "prettier";
import pascalPlugin from "../dist/index";

async function formatPascal(code: string): Promise<string> {
  return await prettier.format(code, {
    parser: "pascal",
    plugins: [pascalPlugin],
    printWidth: 80,
    tabWidth: 2, 
  });
}

test("Pascal Prettier Plugin Test Suite", async (t) => {

  await t.test("Formats basic procedural declarations and forward references", async () => {
    const unformatted = `procedure   Calculate( x:Integer;y:Integer) ;forward  ;`;
    
    // Testing the `declProcFwd` grammar node and your `printDeclProc` logic
    const expected = `procedure Calculate(x: Integer; y: Integer);\nforward;\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats if/else expressions inline", async () => {
    const unformatted = `Result:=if   x=1   then 'One' else   'Other'  ;`;
    
    // Testing the `exprIf` grammar node and `printIfElse` routing
    const expected = `Result := if x = 1 then\n  'One'\nelse\n  'Other';\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats arrays with ranges and subscripts", async () => {
    const unformatted = `var MyArr : array [ 1 .. 10 ] of  Integer ;
begin
MyArr [ 5 ]  := 100 ;
end.`;

    // Testing `range`, `exprSubscript`, and `printDeclArray` logic
    const expected = `var\n  MyArr: array[1..10] of Integer;\nbegin\n  MyArr[5] := 100;\nend.\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

  await t.test("Formats case statements safely", async () => {
    const unformatted = `case i of 1..5:begin DoWork; end; otherwise DoNothing; end;`;

    // Testing `caseCase` and `printCase` handlers
    const expected = `case i of\n  1..5:\n    begin\n      DoWork;\n    end;\n  otherwise\n    DoNothing;\nend;\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });
  
  await t.test("Formats FPC procedural variable assignments with address operator", async () => {
    const unformatted = `LogCallback :=    @PrintLog ;`;

    // Testing the unary `kAt` operator inside an assignment
    const expected = `LogCallback := @PrintLog;\n`;
    
    const result = await formatPascal(unformatted);
    assert.equal(result, expected);
  });

});

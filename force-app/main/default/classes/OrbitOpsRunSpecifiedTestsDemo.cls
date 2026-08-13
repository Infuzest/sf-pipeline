@IsTest
private class OrbitOpsRunSpecifiedTestsDemo {
    @IsTest
    static void demonstratesSelectedTestExecution() {
        Integer expected = 4;
        Integer actual = 2 + 2;

        System.assertEquals(expected, actual, 'OrbitOps executed the selected Apex test.');
    }
}

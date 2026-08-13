@IsTest
private class SFDC_SimpleTest {

    @IsTest
    static void testAssertion() {
        Integer expected = 2;
        Integer actual = 1 + 1;

        System.assertEquals(expected, actual, 'Expected 1 + 1 to equal 2');
    }
}